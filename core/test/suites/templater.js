var testutils = require('../utils'),
    log = require('../../lib/logger'),
    templater = require('../../lib/templater'),
    server = module.exports;

exports.getInstructions = function(assert){
    assert.expect(1);
    var inst = templater.getInstructions('{{title}}');
    assert.ok('title', inst.field);
    assert.done();
};

exports.getInstructionsSimple = function(assert){
    assert.expect(1);
    var inst = templater.getInstructions('title');
    assert.ok('title', inst.field);
    assert.done();
};

exports.getInstructionsSimple = function(assert){
    assert.expect(2);
    var inst = templater.getInstructions('{{title:list:type=blog}}');
    assert.ok('title', inst.field);
    assert.ok('blog', inst.type);
    assert.done();
};

exports.include = function(assert){
    assert.expect(2);
    var inst = templater.getInstructions('{{header.html}}');
    assert.ok(true, inst.include);
    assert.ok('header.html', inst.file);
    assert.done();
};
