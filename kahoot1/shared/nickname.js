// สุ่มชื่อเล่น: คำขยาย + คำนาม + เลขท้ายกันชนกัน
window.KG = window.KG || {};

KG.nickname = (() => {
    const ADJECTIVES = [
        'Turbo', 'Cosmic', 'Sneaky', 'Mega', 'Wobbly', 'Sparkly', 'Grumpy', 'Zippy',
        'Fuzzy', 'Neon', 'Rusty', 'Jolly', 'Silent', 'Spicy', 'Frosty', 'Lucky'
    ];
    const NOUNS = [
        'Comet', 'Panda', 'Noodle', 'Rocket', 'Otter', 'Waffle', 'Falcon', 'Pickle',
        'Meteor', 'Ninja', 'Muffin', 'Tiger', 'Robot', 'Dragon', 'Cactus', 'Wizard'
    ];

    const pick = list => list[Math.floor(Math.random() * list.length)];

    return {
        random() {
            return `${pick(ADJECTIVES)}${pick(NOUNS)}${Math.floor(Math.random() * 90) + 10}`;
        }
    };
})();
