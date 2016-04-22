'use strict';

let q = require('q')
  , mailcomposer = require('mailcomposer')
  , express = require('express')
  , app = express()
  , bodyParser = require('body-parser')
  , SparkPost = require('sparkpost')
  , sp = new SparkPost(process.env.SPARKPOST_API_KEY)
  , redis = require('redis')
  , subscriber = redis.createClient(process.env.REDIS_URL, {no_ready_check: true})
  , publisher = redis.createClient(process.env.REDIS_URL, {no_ready_check: true})
  , subscriberReady = false
  , publisherReady = false
  ;

/*
 * Check the environment/config vars are set up correctly
 */

if (process.env.SPARKPOST_API_KEY === undefined) {
  console.error('SPARKPOST_API_KEY must be set');
  process.exit(1);
}

if (process.env.FORWARD_FROM === undefined) {
  console.error('FORWARD_FROM must be set');
  process.exit(1);
}

if (process.env.FORWARD_TO === undefined) {
  console.error('FORWARD_TO must be set');
  process.exit(1);
}

/*
 * Set up the Redis publish/subscribe queue for incoming messages
 */

subscriber.on('error', function(err) {
  console.error('subscriber: ' + err);
  subscriberReady = false;
});

publisher.on('error', function(err) {
  console.error('publisher: ' + err);
  publisherReady = false;
});

subscriber.on('ready', function() {
  subscriberReady = true;
});

publisher.on('ready', function() {
  publisherReady = true;
});

subscriber.subscribe('queue');

subscriber.on('message', function(channel, message) {
  sp.transmissions.send({
    transmissionBody: {
      content: {
        email_rfc822: message
      },
      recipients: [{address: {email: process.env.FORWARD_TO}}]
    }
  }, function(err, res) {
    if (err) {
      console.error('Transmission failed: ' + JSON.stringify(err));
    } else {
      console.log('Transmission succeeded: ' + JSON.stringify(res.body));
    }
  });
});

/*
 * Set up Express
 */

app.set('port', (process.env.PORT || 5000));

app.use(express.static(__dirname + '/public'));

app.use(bodyParser.json());

// Default of 100k might be too small for many attachments
app.use(bodyParser.json({limit: '10mb'}));

/*
 * GET /webhook -- use the request object to find out where this endpoint is
 * being served from and use that to work out what the webhook endpoint should
 * be. Get the list of webhooks from SparkPost and look for this one.
 */

app.get('/webhook', function(request, response) {
  let appUrl = 'https://' + request.hostname + '/message';
  getWebhooks()
    .then(function(webhooks) {
      for (var i in webhooks) {
        if (webhooks[i].target === appUrl) {
          break;
        }
      }
      return response.status(200).json({app_url: appUrl});
    })
    .fail(function(msg) {
      return response.status(500).json({error: msg});
    });
});

/*
 * POST /webhook -- use the request object to find out where this endpoint is
 * being served from and use that to work out what the webhook endpoint should
 * be. Then set that up in SparkPost.
 */

app.post('/webhook', function(request, response) {
  /*
  try {
    let data = JSON.parse(JSON.stringify(request.body));
  } catch (e) {
    return response.status(400).json({err: 'Invalid data'});
  }
  */
  let appUrl = 'https://' + request.hostname + '/message';
  addWebhook(appUrl)
    .then(function() {
      return response.status(200).json({app_url: appUrl});
    })
    .fail(function(msg) {
      return response.status(500).json({error: msg});
    });
});

/*
 * POST /message -- this is the webhook endpoint. Messages received from
 * SparkPost are put on a Redis queue for later processing, so that 200 can be
 * returned immediately.
 */

app.post('/message', function(request, response) {
  if (!subscriberReady || !publisherReady) {
    return response.status(500).send('Not ready');
  }

  try {
    let bodyString = JSON.stringify(request.body)
      , eventData = JSON.parse(bodyString).results[0].msys.message_event
      , mail = mailcomposer({
      from: 'Mail Delivery System <' + process.env.FORWARD_FROM + '>',
      to: process.env.FORWARD_TO,
      subject: 'Mail Delivery Failure',
      messageId: eventData.message_id,
      headers: [
        { key: 'X-Foo', value: 'bar' }
      ],
      text: bodyString,
      html: ''
    });

    mail.build(function(err, msg) {
      if (err) {
        console.error('Failed to build bounce message: ' + err);
      } else {
        publisher.publish('queue', msg.toString());
      }
    });

    return response.status(200).send('OK');
  } catch (e) {
    return response.status(400).send('Invalid data: ' + e);
  }
});

/*
 * Helper functions
 */

function getWebhooks() {
  return q.Promise(function(resolve, reject) {
    sp.webhooks.all(function(err, data) {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(data.body).results);
      }
    });
  });
}

function addWebhook(appUrl) {
  return q.Promise(function(resolve, reject) {
    sp.webhooks.create({
      target: appUrl,
      name: 'Bounce Forwarding Service',
      auth_token: '1234567890qwertyuio', // TODO do this properly
      events: ['bounce','out_of_band']
    }, function(err) {
      if (err) {
        reject(err);
      } else {
        console.log('Webhook created');
        resolve();
      }
    });
  });
}

app.listen(app.get('port'), function() {
  console.log('Node app is running on port', app.get('port'));
});
