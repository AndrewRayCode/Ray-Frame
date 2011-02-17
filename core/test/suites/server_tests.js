var testutils = require('../utils'),
    log = require('../../lib/logger');

module.exports = testutils.testCase({
    'test simple server loading': function(assert) {
        var self = this;
        assert.expect(1);
        testutils.requestURL(self, assert, {}, {url:'/'}, function(server, response) {
            // Test that the include worked and our server is serving the basic start page
            assert.ok(response.indexOf('I am a child!') > -1);
            assert.done();
        });
    },
    'test simple edit': function(assert) {
        var self = this;
        assert.expect(3);
        testutils.requestURL(self, assert, {}, {
            method:'POST',
            url:'/access/update',
            body: {current_id:'root', current_url_id:'~', field:'global:message', value:'I am a new value'}
        }, function(server, response) {
            // Test that the save method worked
            var j = JSON.parse(response);
            assert.equals(j.status, 'success');
            assert.equals(j.new_value, 'I am a new value');

            // Test that if we hit the page again we get the new value
            testutils.requestURL(self, assert, server, {url:'/'}, function(server, response) {
                assert.ok(response.indexOf('I am a new value') > -1, 'New value was not found on page');
                assert.done();
            });
        });
    }
});
