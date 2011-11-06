var log = require('simple-logger'),
    utils = require('./utils');

function compile(ast, context) {
    var buffer = '',
        outdent = '',
        identifier = 'str',
        viewsToCreate = [];

    var visit = function(node) {
        var vistFn,
            visitKey;

        if(node.length) {
            return visitors.nodeList(node);
        }

        visitKey = node.arity == 'literal' || node.arity == 'template' || node.arity == 'name' || node.arity == 'plip' ? node.arity : node.value;
        
        if((visitFn = visitors[visitKey])) {
            return visitFn(node);
        } else {
            log.warn('Warning: Node compiler not implemented: ' + visitKey, ': ', node);
            return '';
        }
    };

    var visitors = {
        'template': function(node) {
            return addQuotedString(node.value);
        },
        'plip': function(node) {
            var output = '';
            if(Object.keys(node.plipValues).length) {
                if('list' in node.plipValues) {
                    //log.warn(node);
                    viewsToCreate.push(node.plipValues);

                    output += 'templater.templateCache["' + utils.getListName(node) + context.role.name + '"]'
                        + '(cache, templater, user, "' + node.plipName + '", data, function(err, parsed) {'
                        + addString('parsed');
                    outdent += '});';

                    return output;
                } else {

                }
            } else {
                // TODO: Make context data[pageId]
                return addString('context["' + node.plipName + '"]');
            }
        },
        // A list of statements
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

    var empty = function() {};

    var addQuotedString = function(val) {
        return addString('"' + val + '"');
    };

    var addString = function(val) {
        return identifier + '+=' + val + ';';
    };

    return visit(ast) + outdent;
}

var compiler = module.exports;
compiler.compile = compile;
