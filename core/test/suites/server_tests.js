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
            assert.equals(response.status, 'success');
            assert.equals(response.new_value, 'I am a new value');

            // Test that if we hit the page again we get the new value
            testutils.requestURL(self, assert, server, {url:'/'}, function(server, response) {
                assert.ok(response.indexOf('I am a new value') > -1, 'New value was not found on page');
                assert.done();
            });
        });
    },
    // todo: chain addlistitem > get it > savelistitem > load new page > addlistitem > savelistitem > make sure added to homepage list, not new page list
    'test add item to list on sub page': function(assert) {
        var self = this;
        assert.expect(2);
        // Get the homepage to force generation of includesheader.html
        testutils.requestURL(self, assert, {}, {url:'/'}, function(server, response) {
            // Now add a new list item
            testutils.requestURL(self, assert, server, {
                method:'POST',
                url:'/access/addListItem',
                body: {current_id: 'root', current_url_id: '~', plip: 'includesheader.html:pages:list', view: 'page.html'}
            }, function(server, response) {
                assert.ok(response.result, 'We did not get a result from the server when updating a list!!!!!');
                var id = response.result.match(/id="([^"]+)"/)[1];
                testutils.requestURL(self, assert, server, {
                    method:'POST',
                    url:'/access/saveListItem',
                    body: {current_id: 'root', current_url_id: '~', item_plip: id+':title', list_plip: 'includesheader.html:pages:list', title: 'test'}
                }, function(server, response) {
                    testutils.requestURL(self, assert, server, {
                        method:'POST',
                        url:'/access/addListItem',
                        body: {current_id: id, current_url_id: 'test', plip: 'includesheader.html:pages:list', view: 'page.html'}
                    }, function(server, response) {
                        testutils.requestURL(self, assert, server, {
                            method:'POST',
                            url:'/access/saveListItem',
                            body: {current_id: id, current_url_id: 'test', item_plip: id+':title', list_plip: 'includesheader.html:pages:list', title: 'test2'}
                        }, function(server, response) {
                            // Test that if we hit the page again we get the new value
                            testutils.requestURL(self, assert, server, {url:'/test2'}, function(server, response) {
                                assert.ok(response.indexOf('404') == -1, 'The list on the subpage /test has the wrong id for its parent!');
                                assert.done();
                            });
                        });
                    });
                });
            });
        });
    }
});
