const { Payment } = require('./src/models');
async function test() {
  const sum = await Payment.sum('amount', { where: { status: 'lunas' } });
  console.log("SUM:", sum);
  const count = await Payment.count({ where: { status: 'lunas' } });
  console.log("COUNT:", count);
  const all = await Payment.findAll({ where: { status: 'lunas' } });
  console.log("ALL:", all.map(a => a.amount));
}
test().catch(console.error).then(() => process.exit(0));
