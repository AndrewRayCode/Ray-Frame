var testutils = require('./utils'),
    log = require('../lib/logger');

exports.testServer = function(assert){
    testutils.requestURL(assert, {}, {url:'/'}, function(server, response) {
        log.error('response');
        assert.expect(1);
        assert.ok(true, "this assertion should pass");
        assert.done();
    });
};
