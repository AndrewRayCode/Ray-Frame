// http://javascript.crockford.com/tdop/index.html
var log = require('simple-logger');

// Transform a token object into an exception object and throw it.
Object.prototype.error = function(message, t) {
    t = t || this;
    t.name = 'SyntaxError';
    t.message = message;
    throw t;
};

function tokenize(input) {
    var c,                          // The current character.
        from,                       // The index of the start of the token.
        i = 0,                      // The index of the current character.
        length = input.length,
        n,                          // The number value.
        quoteChar,                  // The quote character.
        buffer,                     // The string value.
        prefix,
        suffix,
        inTag = false,
        peek,
        state = 'template',
        tokens = [];                // An array to hold the results.

    var stateClosers = {
        control: '%}',
        plip: '}}'
    };

    // Make a token object.
    var make = function(type, value) {
        var whichValue;

        if(1 in arguments) {
            whichValue = value;
        } else {
            whichValue = buffer;
            buffer = '';
        }
        return {
            type: type,
            value: whichValue,
            from: from,
            inTag: inTag,
            to: i
        };
    };

    var advance = function(jump) {
        i += (0 in arguments ? jump : 1);
        c = input.charAt(i);
        peek = input.charAt(i + 1);
        return c;
    };

    // If prefix and suffix strings are not provided, supply defaults.
    if(typeof prefix !== 'string') {
        prefix = '=<>!+-*&|/%^';
    }
    if(typeof suffix !== 'string') {
        suffix = '=<>&|';
    }

    // Loop through input text, one character at a time.
    advance(0);

    while(c) {
        from = i;

        if(state == 'template') {
            buffer = '';
            for(;;) {
                // Look for control starts
                if(c == '{' && (peek == '{' || peek == '%')) {
                    if(buffer.length) {
                        tokens.push(make('template'));
                    }
                    if(peek == '{') {
                        state = 'plip';
                        tokens.push(make('plipper', '{{'));
                    } else if(peek == '%') {
                        state = 'control';
                        tokens.push(make('controller', '{%'));
                    }

                    // Jump past the control
                    advance(2);

                    break;
                } else {
                    // Look for HTML tags and note when we are between angle brackets
                    if(c == '<' && peek > 'a' && peek <= 'z') {
                        inTag = true;
                    } else if(c == '\n' || c == '\r' || c == '>') {
                        inTag = false;
                    }
                }

                buffer += c;
                advance();

                if(i >= length) {
                    tokens.push(make('template'));
                    break;
                }
            }
        }

        if(state == 'plip') {
            buffer = '';
            for(;;) {

                // Check for end of plip or : divider
                if(c == ':' || (c == '}' && peek == '}')) {

                    // Check for plip assignment
                    if(buffer.indexOf('=') > -1) {
                        var pieces = buffer.split('=');

                        if(pieces.length != 2 || !pieces[0].length || !pieces[1].length) {
                            throw new Error('Invaid plip piece assignment ' + buffer + ', must follow \'key=value\' syntax');
                        }
                        tokens.push(make('plipPieceAssign', buffer.split('=')));

                    // Check for bad plip
                    } else if(buffer.trim() === '') {
                        throw new Error('Invliad plip syntax: \'' + buffer + '\'');

                    // Save plip
                    } else {
                        tokens.push(make('plipPiece'));
                    }

                    if(c != ':') {
                        tokens.push(make('plipper', '}}'));
                        state = 'template';
                        advance(2);
                        break;
                    } else {
                        buffer = '';
                        advance();
                    }
                // Scan plip info and skip whitespace
                } else {
                    if(c >= ' ') {
                        buffer += c;
                    }
                    advance();
                }

                if(i >= length) {
                    throw new Error('Unterimnated ' + state + ' statement found, expected \'' + stateClosers[state] + '\' before end of file.');
                }
            }
        }

        if(state == 'control') {
            if(c == '%' && peek == '}') {
                tokens.push(make('controller', '%}'));
                state = 'template';
                advance(2);
            } else {
                // Ignore whitespace.
                if(c <= ' ') {
                    advance();
                // name.
                } else if((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')) {
                    buffer = c;
                    i += 1;
                    for (;;) {
                        c = input.charAt(i);
                        if((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
                                (c >= '0' && c <= '9') || c === '_') {
                            buffer += c;
                            i += 1;
                        } else {
                            break;
                        }
                    }
                    tokens.push(make('name'));

                // number.

                // A number cannot start with a decimal point. It must start with a digit,
                // possibly '0'.
                } else if(c >= '0' && c <= '9') {
                    buffer = c;

                    // Look for more digits.
                    for (;;) {
                        advance();
                        if(c < '0' || c > '9') {
                            break;
                        }
                        buffer += c;
                    }

                    // Look for a decimal fraction part.
                    if(c === '.') {
                        buffer += c;
                        for (;;) {
                            advance();
                            if(c < '0' || c > '9') {
                                break;
                            }
                            buffer += c;
                        }
                    }

                    // Look for an exponent part.
                    if(c === 'e' || c === 'E') {
                        buffer += c;
                        advance();
                        if(c === '-' || c === '+') {
                            buffer += c;
                            advance();
                        }
                        if(c < '0' || c > '9') {
                            make('number').error('Bad exponent');
                        }
                        do {
                            buffer += c;
                            advance();
                        } while(c >= '0' && c <= '9');
                    }

                    // Make sure the next character is not a letter.
                    if(c >= 'a' && c <= 'z') {
                        buffer += c;
                        i += 1;
                        make('number').error('Bad number');
                    }

                    // Convert the string value to a number. If it is finite, then it is a good
                    // token.
                    n = +buffer;
                    if(isFinite(n)) {
                        tokens.push(make('number', n));
                    } else {
                        make('number').error('Bad number');
                    }

                // string
                } else if(c === '"' || c === '\'') {
                    buffer = '';
                    quoteChar = c;
                    i += 1;
                    for (;;) {
                        c = input.charAt(i);
                        if(c < ' ') {
                            make('string').error(c === '\n' || c === '\r' || c === '' ?
                                    'Unterminated string.' :
                                    'Control character in string.', make(''));
                        }

                        // Look for the closing quote.
                        if(c === quoteChar) {
                            break;
                        }

                        // Look for escapement
                        if(c === '\\') {
                            i += 1;
                            if(i >= length) {
                                make('string').error('Unterminated string');
                            }
                            c = input.charAt(i);
                            switch(c) {
                                case 'b':
                                    c = '\b';
                                    break;
                                case 'f':
                                    c = '\f';
                                    break;
                                case 'n':
                                    c = '\n';
                                    break;
                                case 'r':
                                    c = '\r';
                                    break;
                                case 't':
                                    c = '\t';
                                    break;
                                case 'u':
                                    if(i >= length) {
                                        make('string').error('Unterminated string');
                                    }
                                    c = parseInt(input.substr(i + 1, 4), 16);
                                    if(!isFinite(c) || c < 0) {
                                        make('string').error('Unterminated string');
                                    }
                                    c = String.fromCharCode(c);
                                    i += 4;
                                    break;
                            }
                        }
                        buffer += c;
                        i += 1;
                    }
                    tokens.push(make('string'));
                    advance();

                // comment
                } else if(c === '/' && peek === '/') {
                    for (;;) {
                        advance();
                        if(c === '\n' || c === '\r' || c === '') {
                            break;
                        }
                    }

                // combining
                } else if(prefix.indexOf(c) >= 0) {
                    buffer = c;
                    while(true) {
                        advance();
                        if(i >= length || suffix.indexOf(c) < 0) {
                            break;
                        }
                        buffer += c;
                    }
                    tokens.push(make('operator'));

                // single-character operator
                } else {
                    tokens.push(make('operator', c));
                    c = advance();
                }
            }
        }
    }
    
    if(state != 'template') {
        throw new Error('Unterimnated ' + state + ' statement found, expected \'' + stateClosers[state] + '\' before end of file.');
    }

    return tokens;
}

function make_parser() {
    var scope,
        symbol_table = {},
        token,
        tokens,
        token_nr,
        state = 'template';

    var itself = function() {
        return this;
    };

    var original_scope = {
        define: function(n) {
            var t = this.def[n.value];
            if(typeof t === 'object') {
                n.error(t.reserved ? 'Already reserved.' : 'Already defined.');
            }
            this.def[n.value] = n;
            n.reserved = false;
            n.nud      = itself;
            n.led      = null;
            n.std      = null;
            n.lbp      = 0;
            n.scope    = scope;
            return n;
        },
        find: function(n) {
            var e = this, o;
            while (true) {
                o = e.def[n];
                if(o && typeof o !== 'function') {
                    return e.def[n];
                }
                e = e.parent;
                if(!e) {
                    o = symbol_table[n];
                    return o && typeof o !== 'function' ? o : symbol_table['(name)'];
                }
            }
        },
        pop: function() {
            scope = this.parent;
        },
        reserve: function(n) {
            if(n.arity !== 'name' || n.reserved) {
                return;
            }
            var t = this.def[n.value];
            if(t) {
                if(t.reserved) {
                    return;
                }
                if(t.arity === 'name') {
                    n.error('Already defined.');
                }
            }
            this.def[n.value] = n;
            n.reserved = true;
        }
    };

    var new_scope = function() {
        var s = scope;
        scope = Object.create(original_scope);
        scope.def = {};
        scope.parent = s;
        return scope;
    };

    var advance = function(id) {
        var a, o, t, v;
        if(id && token.id !== id) {
            token.error('Expected \'' + id + '\'.');
        }
        if(token_nr >= tokens.length) {
            token = symbol_table['(end)'];
            return;
        }
        t = tokens[token_nr];
        token_nr += 1;
        v = t.value;
        a = t.type;
        if(state == 'control') {
            if(a === 'name') {
                o = scope.find(v);
            } else if(a === 'operator') {
                o = symbol_table[v];
                if(!o) {
                    t.error('Unknown operator.');
                }
            } else if(a === 'string' || a ===  'number') {
                o = symbol_table['(literal)'];
                a = 'literal';
            } else if(a == 'controller') {
                o = symbol_table[v];
                state = 'template';
            } else {
                t.error('Unexpected token.');
            }
        } else if(state == 'template') {
            if(a == 'controller') {
                state = 'control';
            }
            o = symbol_table[v];
        }
        token = Object.create(o);
        token.from  = t.from;
        token.to    = t.to;
        token.value = v;
        token.arity = a;
        return token;
    };

    var expression = function(rbp) {
        var left;
        var t = token;
        advance();
        left = t.nud();
        while (rbp < token.lbp) {
            t = token;
            advance();
            left = t.led(left);
        }
        return left;
    };

    var statement = function() {
        var n = token, v;

        if(n.std) {
            advance();
            scope.reserve(n);
            return n.std();
        }
        v = expression(0);
        if(!v.assignment && v.id !== '(') {
            v.error('Bad expression statement.');
        }
        advance(';');
        return v;
    };

    var statements = function() {
        var a = [], s;
        while (true) {
            if(token.id === '}' || token.id === '(end)' || token.id == '%}') {
                break;
            }
            s = statement();
            if(s) {
                a.push(s);
            }
        }
        return a.length === 0 ? null : a.length === 1 ? a[0] : a;
    };

    var block = function() {
        var t = token;
        advance('{');
        return t.std();
    };

    var original_symbol = {
        nud: function() {
            this.error('Undefined symbol: ' + this.value);
        },
        led: function(left) {
            this.error('Missing operator.');
        }
    };

    var symbol = function(id, bp) {
        var s = symbol_table[id];
        bp = bp || 0;
        if(s) {
            if(bp >= s.lbp) {
                s.lbp = bp;
            }
        } else {
            s = Object.create(original_symbol);
            s.id = s.value = id;
            s.lbp = bp;
            symbol_table[id] = s;
        }
        return s;
    };

    var constant = function(s, v) {
        var x = symbol(s);
        x.nud = function() {
            scope.reserve(this);
            this.value = symbol_table[this.id].value;
            this.arity = 'literal';
            return this;
        };
        x.value = v;
        return x;
    };

    var infix = function(id, bp, led) {
        var s = symbol(id, bp);
        s.led = led || function(left) {
            this.first = left;
            this.second = expression(bp);
            this.arity = 'binary';
            return this;
        };
        return s;
    };

    var infixr = function(id, bp, led) {
        var s = symbol(id, bp);
        s.led = led || function(left) {
            this.first = left;
            this.second = expression(bp - 1);
            this.arity = 'binary';
            return this;
        };
        return s;
    };

    var assignment = function(id) {
        return infixr(id, 10, function(left) {
            if(left.id !== '.' && left.id !== '[' && left.arity !== 'name') {
                left.error('Bad lvalue.');
            }
            this.first = left;
            this.second = expression(9);
            this.assignment = true;
            this.arity = 'binary';
            return this;
        });
    };

    var prefix = function(id, nud) {
        var s = symbol(id);
        s.nud = nud || function() {
            scope.reserve(this);
            this.first = expression(70);
            this.arity = 'unary';
            return this;
        };
        return s;
    };

    var stmt = function(s, f) {
        var x = symbol(s);
        x.std = f;
        return x;
    };

    symbol('(end)');
    symbol('(name)');
    symbol(':');
    symbol(';');
    symbol(')');
    symbol(']');
    symbol('}');
    symbol(',');
    symbol('else');

    // mine...
    symbol('%}');
    symbol('}}');

    constant('true', true);
    constant('false', false);
    constant('null', null);
    constant('pi', 3.141592653589793);
    constant('Object', {});
    constant('Array', []);

    symbol('(literal)').nud = itself;

    symbol('this').nud = function() {
        scope.reserve(this);
        this.arity = 'this';
        return this;
    };

    assignment('=');
    assignment('+=');
    assignment('-=');

    infix('?', 20, function(left) {
        this.first = left;
        this.second = expression(0);
        advance(':');
        this.third = expression(0);
        this.arity = 'ternary';
        return this;
    });

    infixr('&&', 30);
    infixr('||', 30);

    infixr('===', 40);
    infixr('!==', 40);
    infixr('<', 40);
    infixr('<=', 40);
    infixr('>', 40);
    infixr('>=', 40);

    infix('+', 50);
    infix('-', 50);

    infix('*', 60);
    infix('/', 60);

    infix('.', 80, function(left) {
        this.first = left;
        if(token.arity !== 'name') {
            token.error('Expected a property name.');
        }
        token.arity = 'literal';
        this.second = token;
        this.arity = 'binary';
        advance();
        return this;
    });

    infix('[', 80, function(left) {
        this.first = left;
        this.second = expression(0);
        this.arity = 'binary';
        advance(']');
        return this;
    });

    infix('(', 80, function(left) {
        var a = [];
        if(left.id === '.' || left.id === '[') {
            this.arity = 'ternary';
            this.first = left.first;
            this.second = left.second;
            this.third = a;
        } else {
            this.arity = 'binary';
            this.first = left;
            this.second = a;
            if((left.arity !== 'unary' || left.id !== 'function') &&
                left.arity !== 'name' && left.id !== '(' &&
                left.id !== '&&' && left.id !== '||' && left.id !== '?') {
                left.error('Expected a variable name.');
            }
        }
        if(token.id !== ')') {
            while (true) {
                a.push(expression(0));
                if(token.id !== ',') {
                    break;
                }
                advance(',');
            }
        }
        advance(')');
        return this;
    });

    prefix('!');
    prefix('-');
    prefix('typeof');

    prefix('(', function() {
        var e = expression(0);
        advance(')');
        return e;
    });

    prefix('function', function() {
        var a = [];
        new_scope();
        if(token.arity === 'name') {
            scope.define(token);
            this.name = token.value;
            advance();
        }
        advance('(');
        if(token.id !== ')') {
            while (true) {
                if(token.arity !== 'name') {
                    token.error('Expected a parameter name.');
                }
                scope.define(token);
                a.push(token);
                advance();
                if(token.id !== ',') {
                    break;
                }
                advance(',');
            }
        }
        this.first = a;
        advance(')');
        advance('{');
        this.second = statements();
        advance('}');
        this.arity = 'function';
        scope.pop();
        return this;
    });

    prefix('[', function() {
        var a = [];
        if(token.id !== ']') {
            while (true) {
                a.push(expression(0));
                if(token.id !== ',') {
                    break;
                }
                advance(',');
            }
        }
        advance(']');
        this.first = a;
        this.arity = 'unary';
        return this;
    });

    // Object literal
    prefix('{', function() {
        var a = [], n, v;
        if(token.id !== '}') {
            while (true) {
                n = token;
                if(n.arity !== 'name' && n.arity !== 'literal') {
                    token.error('Bad property name.');
                }
                advance();
                advance(':');
                v = expression(0);
                v.key = n.value;
                a.push(v);
                if(token.id !== ',') {
                    break;
                }
                advance(',');
            }
        }
        advance('}');
        this.first = a;
        this.arity = 'unary';
        return this;
    });

    stmt('{', function () {
        new_scope();
        var a = statements();
        advance('}');
        scope.pop();
        return a;
    }); 

    stmt('{%', function() {
        var a = statements();
        advance('%}');
        return a;
    });

    stmt('var', function() {
        var a = [], n, t;
        while (true) {
            n = token;
            if(n.arity !== 'name') {
                n.error('Expected a new variable name.');
            }
            scope.define(n);
            advance();
            if(token.id === '=') {
                t = token;
                advance('=');
                t.first = n;
                t.second = expression(0);
                t.arity = 'binary';
                a.push(t);
            }
            if(token.id !== ',') {
                break;
            }
            advance(',');
        }
        advance(';');
        return a.length === 0 ? null : a.length === 1 ? a[0] : a;
    });

    stmt('if', function() {
        advance('(');
        this.first = expression(0);
        advance(')');
        this.second = block();
        if(token.id === 'else') {
            scope.reserve(token);
            advance('else');
            this.third = token.id === 'if' ? statement() : block();
        } else {
            this.third = null;
        }
        this.arity = 'statement';
        return this;
    });

    stmt('return', function() {
        if(token.id !== ';') {
            this.first = expression(0);
        }
        advance(';');
        if(token.id !== '}') {
            token.error('Unreachable statement.');
        }
        this.arity = 'statement';
        return this;
    });

    stmt('break', function() {
        advance(';');
        if(token.id !== '}') {
            token.error('Unreachable statement.');
        }
        this.arity = 'statement';
        return this;
    });

    stmt('while', function() {
        advance('(');
        this.first = expression(0);
        advance(')');
        this.second = block();
        this.arity = 'statement';
        return this;
    });

    return function(source) {
        tokens = tokenize(source);
        //console.log(tokens);
        token_nr = 0;
        new_scope();
        advance();
        var s = statements();
        advance('(end)');
        scope.pop();
        return s;
    };
}

var parse = make_parser();

try {
    console.log(parse('{% var cheese; if(cheese === 2) {var a = 3;} %}'));
    //console.log(parse('<div>{% if(cheese == 3) {} %} {{ plumb:poop=cheese:barf }}</div>'));
} catch (e) {
    if(e.hasOwnProperty('name')) {
        log.error('Fatal error: ',e);
    } else {
        throw e;
    }
}
