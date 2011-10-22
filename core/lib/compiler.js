var log = require('simple-logger');

function compile(ast) {
    var buffer = '';

    var visit = function(node) {
        var vistFn,
            visitKey;

        if(node.length) {
            return visitors.nodeList(node);
        }

        visitKey = node.arity == 'literal' || node.arity == 'template' || node.arity == 'name' ? node.arity : node.value;
        
        if((visitFn = visitors[visitKey])) {
            return visitFn(node);
        } else {
            log.warn('Warning: Node compiler not implemented: ' + visitKey, ': ', node);
            return '';
        }
    };

    var visitors = {
        'template': function(node) {
            return node.value;
        },
        'nodeList': function(list) {
            var i = 0,
                node,
                output = '';
            for(; node = list[i++];) {
                output += visit(node);
            }
            return output;
        },
        '=': function(node) {
            return visit(node.first) + '=' + visit(node.second);
        },
        'name': function(node) {
            return 'name';
        },
        'literal': function(node) {
            return 'literal';
        }
    };

    return visit(ast);
}

var compiler = module.exports;
compiler.compile = compile;
