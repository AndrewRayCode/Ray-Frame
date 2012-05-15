var log = require('simple-logger'),
    sys = require('util'),
    utils = require('./utils'),
    compiler = require('./compiler'),
    adminCompiler = module.exports;

adminCompiler = module.exports;
adminCompiler.makeCompiler = function() {
    var base = compiler.makeCompiler();

    base.extend({
        'beforeBlock': function(node, _) {
            var blockName = node.first.value;
            if(base.isList) {
                return base.addQuotedString('<frayme list-start>');
            }
            return '';
        },
        'afterBlock': function(node, _) {
            var blockName = node.first.value;
            if(base.isList) {
                return base.addQuotedString('</frayme>');
            }
            return '';
        },
        'name': function(node, _) {
            var prev = node.previous;
            if(prev && prev.arity === 'template') {
            }
            if(node.plipValues && ('list' in node.plipValues)) {
                return base.addQuotedString('<frayme list>')
                    + _(node)
                    + base.addQuotedString('</frayme>');
            } else if(node.state === 'plip') {
                return base.addQuotedString('<frayme>')
                    + _(node)
                    + base.addQuotedString('</frayme>');
            }
        }
    });
    return base;
};
