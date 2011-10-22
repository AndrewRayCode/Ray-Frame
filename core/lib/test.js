var lexer = require('./lexer'),
    parser = require('./parser'),
    compiler = require('./compiler');

console.log(compiler.compile(parser.parse(lexer.tokenize('{% var a = 3 %} penis'))));
