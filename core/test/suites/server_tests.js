var testutils = require('../utils'),
    utils = require('../../lib/utils'),
    log = require('simple-logger');

module.exports = testutils.testCase({
    'test local includes': function(assert) {
        var self = this;
        assert.expect(2);
        // Get the homepage to force generation of includesheader.html
        testutils.requestURL(self, assert, {}, {url:'/'}, function(server, response) {
			var couch_client = require('felix-couchdb').createClient(5984, 'localhost'),
			couch = couch_client.db('rayframe-test');

			// First save two pages to the homepage
			couch.getDocsByKey(['includesheader.html', 'url:~'], function(err, result) {
				var pageData = result.rows[0].doc;
					urlData = result.rows[1].doc;

				// Make sure to set individual 'weasel' attributes which SHOULD show up on the {{include.html:local}} include on page.html
				utils.addChildByTitle(couch, pageData, 'pages', {template: 'page.html', title:'page1', weasel: 'trout1'}, urlData, function(err, added) {
					utils.addChildByTitle(couch, pageData, 'pages', {template: 'page.html', title:'page2', weasel: 'trout2'}, urlData, function(err, added) {

						// Make sure that page1 gets 'trout1', and page2 gets 'trout2'
						testutils.requestURL(self, assert, server, {url:'/page1'}, function(server, response) {
							assert.ok(response.indexOf('trout1'), 'page1 did not get local include data!!');
							testutils.requestURL(self, assert, server, {url:'/page2'}, function(server, response) {
								assert.ok(response.indexOf('trout2'), 'page2 did not get local include data!!');
								assert.done();
							});
						});
					});
				});
			});
		});
    },
	'test addChildById': function(assert) {
        var self = this;
        assert.expect(3);
        // Get the homepage to force generation of includesheader.html
        testutils.requestURL(self, assert, {}, {url:'/'}, function(server, response) {
			var couch_client = require('felix-couchdb').createClient(5984, 'localhost'),
			couch = couch_client.db('rayframe-test');

			couch.getDocsByKey(['root', 'url:~'], function(err, result) {
				var pageData = result.rows[0].doc;
					urlData = result.rows[1].doc;

				// This is the function we are testing
				utils.addChildById(couch, pageData, 'comments', {template: 'comment.html', title:'hello'}, urlData, function(err, added) {
					assert.ok(added._id);
					couch.getDocsByKey(['root', utils.sanitizeUrl(utils.newUrlFromId(urlData._id, added._id))], function(err, result) {
						// Make sure that the new object was added to comments, and a new url object was created referencing the new object
						assert.equals(result.rows[0].doc.comments[0], added._id);
						assert.equals(result.rows[1].doc.reference, added._id);
						assert.done();
					});
				});
			});
		});
	},
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
            body: {current_id:'root', current_url_id:'url:~', field:'global:message', value:'I am a new value'}
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
                body: {current_id: 'root', current_url_id: 'url:~', plip: 'includesheader.html:pages:list', view: 'page.html'}
            }, function(server, response) {
                assert.ok(response.result, 'We did not get a result from the server when updating a list!!!!!');
                var id = response.result.match(/id="([^"]+)"/)[1];
                testutils.requestURL(self, assert, server, {
                    method:'POST',
                    url:'/access/saveListItem',
                    body: {current_id: 'root', current_url_id: 'url:~', item_plip: id+':title', list_plip: 'includesheader.html:pages:list', title: 'test'}
                }, function(server, response) {
                    testutils.requestURL(self, assert, server, {
                        method:'POST',
                        url:'/access/addListItem',
                        body: {current_id: id, current_url_id: 'url:test', plip: 'includesheader.html:pages:list', view: 'page.html'}
                    }, function(server, response) {
                        testutils.requestURL(self, assert, server, {
                            method:'POST',
                            url:'/access/saveListItem',
                            body: {current_id: id, current_url_id: 'url:test', item_plip: id+':title', list_plip: 'includesheader.html:pages:list', title: 'test2'}
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
    },
	'test adding metadata to form': function(assert) {
        var self = this;
        assert.expect(2);
        // Get the homepage to force generation of includesheader.html
        testutils.requestURL(self, assert, {}, {url:'/'}, function(server, response) {
			assert.ok(response.indexOf('<input type="hidden" name="current_id" value="root">') > -1, 'Page metadata was not correctly added to form');
			assert.ok(response.indexOf('<input type="hidden" name="current_url_id" value="url:~">') > -1, 'URL metadata was not correctly added to form');
			assert.done();
		});
    }
});
