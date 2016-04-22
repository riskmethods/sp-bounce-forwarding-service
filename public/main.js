function errMsg(msg) {
  return '<div class="alert alert-danger" role="alert"> '
    + '<strong>Oh snap!</strong> ' + msg + '</div>';
}

function addWebhook() {
  $('#add_webhook').show();
  $.ajax({
    type: 'POST',
    url: '/webhook',
    dataType: 'json',
    contentType: 'application/json',
    // data: JSON.stringify({ domain: domain }),
    success: function(data){
      $('#add_webhook').html(
        'webhook target is <span style="font-family:monospace">'
          + data.app_url + '</span>');
    },
    error: function(jqXHR) {
      $('#rowcont').prepend(errMsg(jqXHR.responseText));
    }
  });
}

// Initially look for an existing webhook
$.ajax({
  type: 'GET',
  url: '/webhook',
  dataType: 'json',
  success: function(data) {
    $('#get_webhook').html(
      'target: <span style="font-family:monospace">' + data.app_url + '</span><br>'
      );
  },
  error: function(jqXHR) {
    if (jqXHR.status === 404) {
      addWebhook();
    }
    else {
      $('#rowcont').prepend(errMsg(jqXHR.responseText));
    }
  }
});
