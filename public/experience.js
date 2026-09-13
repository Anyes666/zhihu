// Original interaction copy. Questions are invitations, never automatic answers.
export const LETTER_GUIDES = {
  leaving: { cue: '离开，还是留下？先听见没说出口的那半句。', queries: ['异地工作 如何与父母沟通', '成年子女 家庭边界'], words: ['心理', '主动', '沟通', '关系', '职场'], silent: '阿姨，你为什么会打开杭州的租房页面？', data: '回 HR 的截止日是什么时候？' },
  'third-try': { cue: '再坚持一次，和重复一次，差别在哪里？', queries: ['考研失败 如何调整目标', '考研与就业 家庭支持'], words: ['学习', '注意力', '目标', '职场', '心理'], silent: '叔叔，那件反光马甲是做什么用的？', data: '一战和二战报的是同一所学校吗？' },
  colleague: { cue: '开口之前，先弄清自己也在故事里的哪一处。', queries: ['同事工作失误 如何沟通', '职场责任 事实核实'], words: ['职场', '沟通', '关系', '主动'], silent: '小陈，那天在楼道里，你想对我说什么？', data: '这两批货的抽检记录，哪些信息已经确认？', contrarian: '复检单上签的是谁的名字？' }
};
export function starterQuestions(letterId, charId) {
  const guide = LETTER_GUIDES[letterId];
  if (!guide || !['silent','data','laozhou','contrarian'].includes(charId)) return [];
  const specific = guide[charId] || (charId === 'contrarian' ? '这封信里，哪句话最值得再问一次？' : '如果先不急着劝我选边，你会让我先确认什么？');
  return [{ label: '从线索问起', text: specific }, { label: '先听对方说', text: '我想先听你说，你最担心的是什么？' }];
}
export function rankKnowledge(cards, letterId) {
  const words = LETTER_GUIDES[letterId]?.words || [];
  const score = card => words.reduce((n, word, index) => n + (String(card.title).includes(word) ? words.length - index : 0), 0);
  return [...cards].sort((a,b) => score(b) - score(a));
}
export function stageMarkup(stage) {
  const index = { read:0,sort:0,talk:1,write:2,echo:3 }[stage];
  if (index === undefined) return '';
  const labels = ['拆信','寻声','落笔','回响'];
  const goals = ['把“发生了什么”和“我以为怎样”分开。', '问清一个细节，比急着给出十条建议更有用。', '用自己的话回应，也给对方留下选择。', '看看这封回信的后果，再试试另一种说法。'];
  return `<ol>${labels.map((label,i)=>`<li class="${i===index?'current':i<index?'complete':''}" ${i===index?'aria-current="step"':''}><span>${i<index?'✓':String(i+1).padStart(2,'0')}</span>${label}</li>`).join('')}</ol><p>${goals[index]}</p>`;
}
