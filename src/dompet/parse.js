// Reads what Kevin sends the Dompet bot (a sentence, a screenshot of a receipt / bank mutation / e-wallet history /
// exchange trade, or a PDF statement) with Claude and turns it into records: expenses and income sorted into pos,
// Bitcoin buys / sells, investments, new pos, or a question about his money.
import Anthropic from '@anthropic-ai/sdk';
import { INVEST_KINDS } from './db.js';

const MODEL = 'claude-opus-5-5';

const ITEM = {
  type: 'object', additionalProperties: false,
  required: ['type', 'date', 'amount', 'pos', 'pos_is_new', 'pos_period', 'pos_emoji', 'merchant', 'note', 'account',
    'btc', 'rate_pa', 'compounding', 'tax_pct', 'end_date', 'invest_kind'],
  properties: {
    type: { type: 'string', enum: ['expense', 'income', 'btc_buy', 'btc_sell', 'investment', 'pos'],
      description: 'expense / income: money spent or received. btc_buy / btc_sell: a Bitcoin trade. investment: money placed in an interest-bearing product. pos: Kevin asks to create or change a spending category.' },
    date: { type: 'string', description: 'YYYY-MM-DD of the transaction (from the screenshot, or relative words like "kemarin" resolved against today). Empty string if unknown.' },
    amount: { type: 'integer', description: 'Whole rupiah. expense/income: the amount. btc_*: total rupiah paid or received incl. fees. investment: the principal. pos: the budget per period, 0 if none. 0 if not in rupiah or unreadable.' },
    pos: { type: 'string', description: 'expense / pos: the pos (category) name. Use an existing pos name exactly when one fits; otherwise a short new name in Indonesian. Empty for other types.' },
    pos_is_new: { type: 'boolean', description: 'True only when `pos` is not one of the existing pos.' },
    pos_period: { type: 'string', enum: ['daily', 'weekly', 'monthly'], description: 'Rhythm of this kind of spending: daily (food, coffee, ride-hailing), weekly (groceries, outings), monthly (bills, rent, subscriptions, big purchases). For an existing pos, its own period.' },
    pos_emoji: { type: 'string', description: 'One emoji for a new pos, else empty.' },
    merchant: { type: 'string', description: 'Shop, payee, payer or exchange, as written. Empty if none.' },
    note: { type: 'string', description: 'Short Indonesian note (what was bought, items, or why). Empty if nothing useful.' },
    account: { type: 'string', description: 'Paid from / received into: BCA, Mandiri, BRI, Jago, GoPay, OVO, DANA, ShopeePay, cash, credit card ... Empty if unknown.' },
    btc: { type: 'number', description: 'btc_*: amount of BTC. 0 otherwise.' },
    rate_pa: { type: 'number', description: 'investment: interest or expected yield in % per year (e.g. 5.25). 0 otherwise.' },
    compounding: { type: 'string', enum: ['simple', 'daily', 'monthly'], description: 'investment: daily for money-market funds and daily-interest savings, monthly for rolled-over (ARO) deposits, simple otherwise.' },
    tax_pct: { type: 'number', description: 'investment: tax on interest in % (20 for Indonesian deposito and savings interest, 10 for SBN/obligasi coupons, 0 for reksa dana and if unknown or stated net).' },
    end_date: { type: 'string', description: 'investment: maturity date YYYY-MM-DD (start + tenor), empty if open-ended.' },
    invest_kind: { type: 'string', enum: INVEST_KINDS, description: 'investment: the product type. "lainnya" otherwise.' },
  },
};
const SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['items', 'query', 'skipped', 'reply'],
  properties: {
    items: { type: 'array', items: ITEM, description: 'Everything to record, in order. Empty when the message is only a question or nothing can be read.' },
    query: { type: 'string', enum: ['none', 'today', 'week', 'month', 'pos', 'btc', 'ihsg', 'invest', 'porto', 'help'],
      description: 'When Kevin asks about his money instead of (or as well as) recording: today = spending today, week, month, pos = budgets per pos, btc = Bitcoin price and holdings, ihsg = IHSG index, invest = interest on investments, porto = everything he owns, help = how to use the bot. none otherwise.' },
    skipped: { type: 'string', description: 'Short Indonesian note on lines deliberately not recorded (e.g. transfer between own accounts, e-wallet top-up, card bill payment, foreign currency). Empty if none.' },
    reply: { type: 'string', description: 'Only when something needs Kevin: a short Indonesian question or explanation (unreadable image, missing amount). Empty otherwise.' },
  },
};

const SYSTEM = `You are the bookkeeper behind Kevin's personal finance bot on Telegram. Kevin lives in Bali; amounts are Indonesian rupiah.
Read his message (a sentence, a screenshot, a photo of a receipt, or a PDF statement) and return what to record.

Rules:
- Rupiah shorthand: "25rb"/"25k" = 25000, "1,5jt"/"1.5jt" = 1500000, "2M"/"2 miliar" = 2000000000. Indonesian screenshots use "." as thousands separator ("Rp45.000" = 45000).
- A receipt or invoice is ONE expense for the total paid (after discounts, incl. tax/service), with the merchant and a short note of the main items.
- A bank mutation, e-wallet history or statement lists many transactions: one item per line. Debits are expenses, credits are income.
  Do not record moves between Kevin's own pockets: transfers to his own accounts, e-wallet top-ups, credit-card bill payments, cash withdrawals; mention them in "skipped".
  A transfer to an exchange or a deposito/fund purchase is not an expense: record it as btc_buy or investment if the details are there, otherwise skip it and say so.
- Choose the pos from the existing list whenever one fits, spelled exactly. Make a new pos only for spending that clearly fits none of them, with the right period.
- Dates: use the date shown; for "kemarin", "tadi pagi", "senin" etc. work it out from today; otherwise today.
- Bitcoin: screenshots from Indodax, Pintu, Tokocrypto, Binance, Reku etc. give the BTC amount and the rupiah total; a sentence like "beli btc 0,002 seharga 3,1jt" too.
- Investments: deposito, reksa dana, SBN/ORI/SR, obligasi, P2P, high-interest savings, with principal, rate % per year, tenor and start date.
- "buat pos Kopi harian budget 50rb" or "budget makan 150rb sehari" is a pos item (create or change a category and its budget).
- If Kevin only asks something ("pengeluaran minggu ini berapa?", "harga btc?"), return no items and set query.
- If an amount is in another currency, or the image is unreadable, do not guess: leave it out and explain in "reply" or "skipped".
- Write notes, skipped and reply in short, plain Indonesian.`;

/** Turns Kevin's message into { items, query, skipped, reply }. `media` is { media_type, data(base64) } for a photo or PDF. */
export async function parseMessage(env, { text, media, today, pos }) {
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY belum diisi di worker likuloka-kantor');
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, ...(env.ANTHROPIC_BASE_URL ? { baseURL: env.ANTHROPIC_BASE_URL } : {}) });
  const content = [];
  if (media?.media_type === 'application/pdf') content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: media.data } });
  else if (media) content.push({ type: 'image', source: { type: 'base64', media_type: media.media_type, data: media.data } });
  const posList = pos.map(p => `- ${p.name} (${p.period})`).join('\n');
  content.push({ type: 'text', text: `Today (WITA): ${today}\nExisting pos:\n${posList}\n\nKevin's message: ${text ? text : media ? '(only the attachment)' : '(empty)'}` });
  let response;
  try {
    response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: 'user', content }],
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new Error('ANTHROPIC_API_KEY di worker likuloka-kantor tidak valid');
    if (e instanceof Anthropic.RateLimitError) throw new Error('Claude sedang sibuk (rate limit), coba lagi sebentar lagi');
    if (e instanceof Anthropic.BadRequestError) throw new Error(`Claude menolak permintaan: ${e.message}`);
    if (e instanceof Anthropic.APIError) throw new Error(`Claude API error ${e.status}`);
    throw e;
  }
  if (response.stop_reason === 'refusal') throw new Error('Claude tidak mau membaca pesan ini');
  if (response.stop_reason === 'max_tokens') throw new Error('Terlalu banyak transaksi dalam satu pesan; kirim per halaman');
  return JSON.parse(response.content.filter(b => b.type === 'text').map(b => b.text).join(''));
}
