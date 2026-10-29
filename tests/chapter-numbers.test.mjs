import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseChapterNumbers as parse} from '../scripts/chapter-numbers.mjs';
test('shared chapter syntax handles ranges, lists, Persian digits and invalid input',()=>{
 assert.deepEqual(parse('1-10'),Array.from({length:10},(_,i)=>String(i+1)));
 assert.deepEqual(parse('1'),['1']);
 assert.deepEqual(parse('1/ 2/ 8/ 21/'),['1','2','8','21']);
 assert.deepEqual(parse('۱-۳ / ٨ / ۰ / 33.5 / 1/'),['1','2','3','8','0','33.5']);
 for(const input of ['', '1//2', '3-1', '1-501', 'abc', '-1', '1/abc/'])assert.throws(()=>parse(input));
});
