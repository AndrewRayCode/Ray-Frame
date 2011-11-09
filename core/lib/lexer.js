// http://javascript.crockford.com/tdop/index.html
var log = require('simple-logger');

function error(token, message) {
    token.name = 'SyntaxError';
    token.message = message;
    throw token;
}

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
        setPeek();
        return c;
    };

    var previousToken = function() {
        return tokens[tokens.length - 1];
    };

    var setPeek = function() {
        peek = input.charAt(i + 1);
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
                        tokens.push(make('template', buffer || ''));
                    }
                    if(peek == '{') {
                        state = 'plip';
                        tokens.push(make('plip', '{{'));
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

        if(state == 'control' || state == 'plip') {
            if(c == '%' && peek == '}') {
                tokens.push(make('controller', '%}'));
                state = 'template';
                advance(2);
            } else if(c == '}' && peek == '}') {
                tokens.push(make('plip', '}}'));
                state = 'template';
                advance(2);
            } else {
                // Ignore whitespace
                if(c <= ' ') {
                    advance();
                // name
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
                    setPeek();
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
                            error(make('number'), 'Bad exponent');
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
                        error(make('number'), 'Bad number');
                    }
                    setPeek();

                    // Convert the string value to a number. If it is finite, then it is a good
                    // token.
                    n = +buffer;
                    if(isFinite(n)) {
                        tokens.push(make('number', n));
                    } else {
                        error(make('number'), 'Bad number');
                    }

                // string
                } else if(c === '"' || c === '\'') {
                    buffer = '';
                    quoteChar = c;
                    i += 1;
                    for (;;) {
                        c = input.charAt(i);
                        if(c < ' ') {
                            error(make('string'), c === '\n' || c === '\r' || c === '' ?
                                    'Unterminated string.' :
                                    'Control character in string.');
                        }

                        // Look for the closing quote.
                        if(c === quoteChar) {
                            break;
                        }

                        // Look for escapement
                        if(c === '\\') {
                            i += 1;
                            if(i >= length) {
                                error(make('string'), 'Unterminated string');
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
                                        error(make('string'), 'Unterminated string');
                                    }
                                    c = parseInt(input.substr(i + 1, 4), 16);
                                    if(!isFinite(c) || c < 0) {
                                        error(make('string'), 'Unterminated string');
                                    }
                                    c = String.fromCharCode(c);
                                    i += 4;
                                    break;
                            }
                        }
                        buffer += c;
                        i += 1;
                    }
                    setPeek();
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

var lexer = module.exports;
lexer.tokenize = tokenize;
