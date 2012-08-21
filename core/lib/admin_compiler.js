var log = require('simple-logger'),
    sys = require('util'),
    utils = require('./utils'),
    compiler = require('./compiler'),
    adminCompiler = module.exports;

adminCompiler = module.exports;
adminCompiler.makeCompiler = function() {
    var base = compiler.makeCompiler(),
        tagsToWatch = ['head', 'title'],
        tagStack = [],
        closers = [],
        adminify;

    // generate an html tag regex for fields we don't want to wrap in edit
    // markup
    tagsToWatch = tagsToWatch.map(function(tag) {
        closers.push('</(' + tag + ')\\s*>');
        return '<(' + tag + ')[^>]*>';
    });
    var tagRegex = new RegExp(tagsToWatch.join('|'));
    var poppers = new RegExp(closers.join('|'));

    // insert included files html-ily
    var addIncludes = function() {
        var str = '',
            includes = (base.context && base.context.role.includes) || [];
        for(var x = 0, include; include = includes[x++];) {
            str += addInclude(include);
        }
        return str;
    };

    var addInclude = function(include) {
        if(include.href && include.href.indexOf('.css')) {
            return '<link rel="stylesheet" href="' + include.href + '" />';
        } else if(include.src && include.src.indexOf('.js')) {
            return '<script src="' + include.src + '"></script>';
        }
    };

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
            if(node.plipValues && ('list' in node.plipValues)) {
                return base.addQuotedString('<frayme list>')
                    + _(node)
                    + base.addQuotedString('</frayme>');
            // see template walker for adminify
            } else if(adminify && node.state === 'plip') {
                return base.addString(base.quote('<!-- ') + ' + pageId + ' + base.quote(':' + node.value + ' -->'))
                    + _(node)
                    + base.addQuotedString('<!-- end -->');
            }
            return _(node);
        },
        'template': function(node) {
            var value = node.value,
                tag;

            // voodoo code. if we're inside, for example, a head tag, we don't
            // want to show html edit controls around fields. attempt to track
            // which dangerous tags we are inside here
            if( (tag = value.match(tagRegex)) ) {
                tagStack.push(tag[1]);
            } else if( (tag = value.match(poppers)) ) {
                tagStack.splice(tagStack.indexOf(tag));
            }
            adminify = !tagStack.length;

            // more voodoo, attach admin includes to closing body tag, if there
            // is one
            if(value && value.length) {
                if(~value.indexOf('</body>')) {
                    value = value.replace('</body>', addIncludes() + '</body>');
                }
                return base.addQuotedString(base.escapeChars(value));
            }
            return '';
        }
    });
    return base;
};
