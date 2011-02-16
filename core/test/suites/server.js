var testutils = require('../utils'),
    log = require('../../lib/logger'),
    server = module.exports;

exports.testServer = function(assert){
    assert.expect(1);
    testutils.requestURL(assert, {}, {url:'/'}, function(server, response) {
        assert.ok(true, "this assertion should pass");
        assert.done();
    });
};
