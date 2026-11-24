// Edit these, commit, and redeploy to change the rules.
module.exports = {
  SUPER_LIMIT: 15,
  // Voters. The first one with admin:true can close voting and always sees everyone's results.
  VOTERS: [
    { name: 'Blair', admin: true },
    { name: 'Chad' },
    { name: 'Jack' },
    { name: 'Angus' },
    { name: 'Adam' },
    { name: 'Morehu' },
    { name: 'Campbell' },
    { name: 'Cody' },
    { name: 'Manu' },
  ],
};
