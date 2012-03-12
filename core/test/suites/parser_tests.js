var testutils = require('../utils'),
    log = require('simple-logger'),
    lexer = require('../../lib/lexer'),
    parser = require('../../lib/parser');

module.exports = testutils.testCase({
    'parse if': function(assert) {
        assert.ok(
            new tree('{% if oink %}{% endif %}')
                .hasExactlyOneChild('if')
        );
        assert.done();
    },
    'parse or in if': function(assert) {
        assert.ok(
            new tree('{% if oink || cheese %}{% endif %}')
                .hasExactlyOneChild('||')
        );
        assert.done();
    },
    'get first branch of else': function(assert) {
        assert.ok(
            new tree('{% if oink %}ducks{% else %}{% endif %}')
                .hasExactlyOneChild('ducks')
        );
        assert.done();
    },
    'get second branch of else': function(assert) {
        assert.ok(
            new tree('{% if oink %}{% else %}ducks{% endif %}')
                .hasExactlyOneChild('ducks')
        );
        assert.done();
    },
    'else is not included as a node': function(assert) {
        assert.ok(
            new tree('{% if oink %}{% else %}{% endif %}')
                .usedBirthControlFor('else')
        );
        assert.done();
    },
    'read a block statement': function(assert) {
        assert.ok(
            new tree('{% block \'list.start\' %}a{% endblock %}')
                .hasExactlyOneChild('block')
        );
        assert.done();
    },
    'parses local extends': function(assert) {
        assert.ok(
            new tree('{% extends local \'a.html\' %}')
                .hasExactlyOneChild('localextends')
        );
        assert.done();
    },
    'read extends name properly': function(assert) {
        assert.ok(
            new tree('{% extends \'a.html\' %}')
                .hasExactlyOneChild('a.html')
        );
        assert.done();
    },
    'parse a plip! (get its name correctly)': function(assert) {
        assert.ok(
            new tree('{{ baloneyOverflowsFromMyBrain }}')
                .hasExactlyOneChild('baloneyOverflowsFromMyBrain')
        );
        assert.done();
    },
    'parse a function call name from if statement': function(assert) {
        assert.ok(
            new tree('{% if shrim() %}{%endif%}')
                .hasExactlyOneChild('shrim')
        );
        assert.done();
    },
    'read an async call from an if statement': function(assert) {
        assert.ok(
            new tree('{% if async shrim() %}{%endif%}')
                .hasExactlyOneChild(['async', 'shrim'])
        );
        assert.done();
    },
    'parse a key value for loop': function(assert) {
        assert.ok(
            new tree('{% for bob,saget in fullHouse %}{% endfor %}')
                .hasExactlyOneChild('for')
        );
        assert.done();
    },
    'parse a regular for in loop': function(assert) {
        assert.ok(
            new tree('{% for blorf in schmungleblargnle %}{% endfor %}')
                .hasExactlyOneChild('for')
        );
        assert.done();
    },
    'parse a list control statement': function(assert) {
        assert.ok(
            new tree('{% list %} stuff after the declaration!').isList()
        );
        assert.done();
    },
    'a list plip does not make it a list': function(assert) {
        assert.ok(
            new tree('{{ list }} stuff after the declaration!').aintNoList()
        );
        assert.done();
    },
    'a list plip is parsed correctly': function(assert) {
        assert.ok(
            new tree('{{ list.even }}')
                .hasExactlyOneChild(['list', 'even'])
        );
        assert.done();
    }
});

var tree = function(string) {

    var parsed = parser.parse(lexer.tokenize(string));

    this.isList = function() {
        return parsed.metadata.isList;
    };

    this.aintNoList = function() {
        return !this.isList();
    };

    this.hasExactlyOneChild = function(value) {
        if(value instanceof Array) {
            for(var i = 0, nodeValue; nodeValue = value[i++];) {
                if(!hasExactlyOneChild(parsed.ast, nodeValue)) {
                    return false;
                }
            }
            return true;
        }
        return hasExactlyOneChild(parsed.ast, value);
    };

    this.hasChild = function(value) {
        return hasChild(parsed.ast, value);
    };

    this.usedBirthControlFor = function(value) {
        return !hasChild(parsed.ast, value);
    };

    // My favorite drinking game
    this.grepForChildren = function(value) {
        return grepForChildren(parsed.ast, value);
    };
};

var hasExactlyOneChild = function(node, value) {
    var arr = [];
    grepForChildren(node, value, arr);
    return arr.length === 1 ? arr[0] : false;
};

var hasChild = function(node, value) {
    var arr = [];
    grepForChildren(node, value, arr);
    return arr.length ? arr[0] : false;
};

// My favorite drinking game
var grepForChildren = function(node, value, findings) {
    // If this isn't a nodelist, turn it into one
    var nodes = (node.length ? node : [node]),
        i = 0,
        toSearch,
        found;

    for(; toSearch = nodes[i++];) {
        if(toSearch.value === value) {
            findings.push(node);
        }
        if((found = (toSearch.first && hasChild(toSearch.first, value, findings))
                || (toSearch.second && hasChild(toSearch.second, value, findings))
                || (toSearch.third && hasChild(toSearch.third, value, findings)))) {
            findings.push(found);
        }
    }
};
