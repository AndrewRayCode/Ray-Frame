var testutils = require('../utils'),
    log = require('../../lib/logger'),
    templater = require('../../lib/templater');

module.exports = testutils.testCase({
    'get title from instruction': function(assert) {
        assert.expect(1);
        var inst = templater.getInstructions('{{title}}');
        assert.ok('title', inst.field);
        assert.done();
    },
    'get simple instruction': function(assert){
        assert.expect(1);
        var inst = templater.getInstructions('title');
        assert.ok('title', inst.field);
        assert.done();
    },
    'get simple instructions with type': function(assert){
        assert.expect(2);
        var inst = templater.getInstructions('{{title:list:type=blog}}');
        assert.ok('title', inst.field);
        assert.ok('blog', inst.type);
        assert.done();
    },
    'test find include': function(assert){
        assert.expect(2);
        var inst = templater.getInstructions('{{header.html}}');
        assert.ok(true, inst.include);
        assert.ok('header.html', inst.file);
        assert.done();
    },
    'test locals in template string': function(assert) {
        assert.expect(1);
        templater.buildTemplateString('<div>{{title}}</div>', function(err, str) {
            templater.saveTemplateString('test', str)(0, {title: 'hi'}, function(err, str) {
                // Make sure hi was parsed out
                assert.equals(str, '<div>hi</div>');
                assert.done();
            });
        });
    }
});
