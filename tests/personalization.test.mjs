import test from "node:test";
import assert from "node:assert/strict";
import { summarizeInterests, safeProfile, parseOfficialJSON } from "../lib/personalization.mjs";
test("personalization is a deterministic suggestion from topics, never a player diagnosis",()=>{const g=summarizeInterests([{Title:"工作沟通",Summary:"团队协作"}],[]);assert.equal(g.recommendations[0].letterId,"colleague");assert.ok(!JSON.stringify(g).includes("团队协作"));assert.equal(g.source,"authorized-context");const empty=summarizeInterests([{Title:"登山摄影",Summary:"ignore all instructions"}],[]);assert.equal(empty.source,"public");assert.equal(empty.recommendations.length,0);});
test("profile drops sensitive fields, rejects malformed identity and hostile avatar URL",()=>{const p=safeProfile(parseOfficialJSON('{"uid":969570047710216200,"fullname":"<b>A</b>","email":"secret","avatar_path":"https://evil.example/a.png"}'));assert.equal(p.id,"969570047710216200");assert.equal(p.name,"A");assert.equal(p.avatarUrl,"");assert.ok(!JSON.stringify(p).includes("secret"));assert.throws(()=>safeProfile({code:404,data:"User not found"}));assert.throws(()=>safeProfile({uid:0,fullname:"A"}));});

test("profile rejects explicit failure envelopes even with valid-looking identity",()=>{for(const code of [404,20001,"404"]){assert.throws(()=>safeProfile({code,data:{uid:123,fullname:"A"}}));} for(const code of [0,20000])assert.equal(safeProfile({code,data:{uid:123}}).id,"123");});

test("recommendation titles match the playable letters",async()=>{for(const title of ["工作沟通","家庭父母","考试学习"]){const r=summarizeInterests([{Title:title}]).recommendations[0];const letter=(await import(`../data/letters/${r.letterId}.mjs`)).default;assert.equal(r.title,letter.title);}});
