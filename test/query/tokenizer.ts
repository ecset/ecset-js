import { suite } from 'uvu';
import assert from 'uvu/assert';

import { createLog } from '../../src/util/log';
import { tokenize, tokenizeString } from '../../src/query/tokenizer';
import * as Tokenizer from '../../src/query/tokenizer';

const Log = createLog('TestQueryTokenizer');

const test = suite('tokenizer');

test.skip('parses', async () => {
    let data, out;
    // out = tokenize(`[ "/component/title", "text" ] 29 :nope !d +\n`);
    out = tokenize(undefined, `[ "/component/title", "te`);
    out = tokenize(out, `xt" ] 29 :nope !d +\n`);

    Log.debug(out.output);

    out = tokenizeString(`{ "debug": true } \n`);
    Log.debug(out);

    data = `1 version == assert

        // create a new EntitySet
        { debug: true, ace:99 } !es
        `;

    out = tokenizeString(data);
    Log.debug(out);

    //     // Log.debug( Tokenizer );

    data = `
    {
        # TL;DR
        human:   Hjson
        machine: JSON
    }`;
    out = tokenizeString(data);
    Log.debug(out);

    data = `{
            md:
                '''
                First line.
                Second line.
                  This line is indented by two spaces.
                '''
            }`;
    out = tokenizeString(data);
    Log.debug(out);

    data = `
        {
            "key name": "{ sample }"
            "{}": " spaces at the start/end "
            this: "is OK though: {}[],:"
        }`;
    out = tokenizeString(data);
    Log.debug(out);
});

test('tokenizeString', () => {
    const cases = [
        [
            '[29]',
            [
                ['[', 0, 0],
                [29, 1, 0],
                [']', 3, 0],
            ],
        ],
        [
            '[29] 30',
            [
                ['[', 0, 0],
                [29, 1, 0],
                [']', 3, 0],
                [30, 5, 0],
            ],
        ],
        [
            '[29,+] 30',
            [
                ['[', 0, 0],
                [29, 1, 0],
                ['+', 4, 0],
                [']', 5, 0],
                [30, 7, 0],
            ],
        ],
        [`"get out of bed"`, [['get out of bed', 0, 0]]],
        [
            `{"name":"Completed","url":"/component/completed","properties":[{"name":"isComplete","type":"boolean"}]} !d`,
            [
                ['{', 0, 0],
                ['name', 1, 0],
                ['Completed', 8, 0],
                ['url', 20, 0],
                ['/component/completed', 26, 0],
                ['properties', 49, 0],
                ['[', 62, 0],
                ['{', 63, 0],
                ['name', 64, 0],
                ['isComplete', 71, 0],
                ['type', 84, 0],
                ['boolean', 91, 0],
                ['}', 100, 0],
                [']', 101, 0],
                ['}', 102, 0],
                ['!d', 104, 0],
            ],
        ],
        [`~d|2020-06-04T06:38:12.261Z|`, [['~d|2020-06-04T06:38:12.261Z|', 0, 0]]],
        [`"file:///test/fixtures/rootA/static/"`, [['file:///test/fixtures/rootA/static/', 0, 0]]],
        [
            `{
            md:
                '''
                First line.
                Second line.
                  This line is indented by two spaces.
                '''
            }`,
            [
                ['{', 0, 0],
                ['md', 14, 1],
                ['First line.\nSecond line.\n  This line is indented by two spaces.\n', 34, 6],
                ['}', 182, 7],
            ],
        ],
        [
            `{
                # TL;DR
                human:   Hjson
                machine: JSON
            }`,
            [
                ['{', 0, 0],
                ['human', 42, 2],
                ['Hjson', 51, 2],
                ['machine', 73, 3],
                ['JSON', 82, 3],
                ['}', 99, 4],
            ],
        ],
        [
            `{ 'name':'finn' }`,
            [
                ['{', 0, 0],
                ['name', 3, 0],
                ['finn', 10, 0],
                ['}', 16, 0],
            ],
        ],
        [
            `[ "oh cheese" '' size! ]`,
            [
                ['[', 0, 0],
                ['oh cheese', 2, 0],
                ['', 14, 0],
                ['size!', 17, 0],
                [']', 23, 0],
            ],
        ],
        [
            `:atom { msg : :world}`,
            [
                [':atom', 0, 0],
                ['{', 6, 0],
                ['msg', 8, 0],
                [':world', 14, 0],
                ['}', 20, 0],
            ],
        ],
        [
            `{"@e":1004}`,
            [
                ['{', 0, 0],
                ['@e', 1, 0],
                [1004, 6, 0],
                ['}', 10, 0],
            ],
        ],
        [
            `[ "/component/dir", { "@e":1004, "url":"file:///test/fixtures/rootA/purgatory" } ]`,
            [
                ['[', 0, 0],
                ['/component/dir', 2, 0],
                ['{', 20, 0],
                ['@e', 22, 0],
                [1004, 27, 0],
                ['url', 33, 0],
                ['file:///test/fixtures/rootA/purgatory', 39, 0],
                ['}', 79, 0],
                [']', 81, 0],
            ],
        ],
        [
            `{ "meta":{ "author":"av" }, }`,
            [
                ['{', 0, 0],
                ['meta', 2, 0],
                ['{', 9, 0],
                ['author', 11, 0],
                ['av', 20, 0],
                ['}', 25, 0],
                ['}', 28, 0],
            ],
        ],
        [
            `[ "/component/meta", { 
                "meta":{ 
                    "author":"av",
                    "tags": [ "first", "action" ] 
                    }
                    "createdAt":"2020-05-23T09:00:00.000Z"
                } 
                ]`,
            [
                ['[', 0, 0],
                ['/component/meta', 2, 0],
                ['{', 21, 0],
                ['meta', 40, 1],
                ['{', 47, 1],
                ['author', 70, 2],
                ['av', 79, 2],
                ['tags', 105, 3],
                ['[', 113, 3],
                ['first', 115, 3],
                ['action', 124, 3],
                [']', 133, 3],
                ['}', 156, 4],
                ['createdAt', 178, 5],
                ['2020-05-23T09:00:00.000Z', 190, 5],
                ['}', 233, 6],
                [']', 252, 7],
            ],
        ],
        [
            `{@e: 3, text: hello}`,
            [
                ['{', 0, 0],
                ['@e', 1, 0],
                [3, 5, 0],
                ['text', 8, 0],
                ['hello', 14, 0],
                ['}', 19, 0],
            ],
        ],
    ];

    cases.forEach(([input, expected]) => {
        const output = tokenizeString(input as string);
        // console.log(input, output);
        assert.equal(output, expected as []);
    });
});

test.run();
