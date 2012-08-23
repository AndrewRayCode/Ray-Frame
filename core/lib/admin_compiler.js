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
        'start': function(node, _) {
            // construct a regex to know if we're inside an html tag and cannot
            // safely insert html comments as edit markers

            // /<[^>]*?(([^>\s]+)=['"]?)?$/
            return 'var aReg = /<' // look for opening tag...
                + '[^>]*?' // anything that doesn't close the tag...
                + '(([^>\\s]+)' // capture the attribute name if given...
                + '=[\'"]?)?$/, aMatch, aSplit;' // and up to end of string
                + _(node);
        },
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
                // hoo boy, here we go...
                var str = base.identifier;

                // Check if the rendered output up to this point contains an
                // unclosed html tag, eg < without >
                return 'if((aMatch = ' + str + '.match(aReg))) {'
                    // If it does and we're inside an attribute...
                    + 'if(aMatch[2]) {'
                    // capture from the tag start until the end of the output
                    + 'aSplit = '
                        + str + '.substring(' + str + '.lastIndexOf("<"));'
                    // and split the rendered output where the tag starts
                    + str + ' = '
                        + str + '.substring(0, ' + str + '.lastIndexOf("<"));'
                    // then set a marker with which attribute we're on
                    + base.addString(
                        base.quote('<!-- attr:') + ' + aMatch[2] + '
                        + base.quote(':plip:') + ' + pageId + ' + base.quote(':' + node.value + ' -->')
                    )
                    // then re-add the rest of the html
                    + str + '+= aSplit;'
                    + '}'
                    // otherwise we're *probably* in the good old visible DOM
                    + '} else if(!aMatch) {'
                    // drop an edit start marker
                    + base.addString(base.quote('<!-- plip:') + ' + pageId + ' + base.quote(':' + node.value + ' -->'))
                    + '}'
                    + _(node)
                    // and drop an end marker if we weren't in an attribute
                    + 'if(!aMatch) {'
                    + base.addQuotedString('<!-- end -->')
                    + '}';
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
