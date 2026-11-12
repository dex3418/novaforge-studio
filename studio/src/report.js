'use strict';
// Pipeline report: one entry per stage, so you can see exactly which stage worked,
// which fell back and which failed. Written next to the outputs as <name>-report.md
// and shown on the GitHub run page (job summary + warnings).

const fs = require('fs');
const path = require('path');

const ICON = { ok: 'OK', warn: 'WARN', fail: 'FAIL', skip: 'SKIPPED' };

class Report {
  constructor(slug) {
    this.slug = slug;
    this.stages = [];
    this.t0 = Date.now();
  }

  add(name, status, summary, details = []) {
    const st = { name, status, summary, details: details.filter(Boolean), ms: 0 };
    this.stages.push(st);
    const line = `[${ICON[status] || status}] ${name}: ${summary}`;
    console.log('  ' + line);
    if (status === 'warn' || status === 'fail') {
      console.log(`::warning title=${this.slug} / ${name}::${String(summary).replace(/[\r\n]+/g, ' ')}`);
    }
    return st;
  }

  // runs fn, records status from what it returns ({status, summary, details}) or from a thrown error
  async run(name, fn) {
    const t = Date.now();
    try {
      const r = (await fn()) || {};
      const st = this.add(name, r.status || 'ok', r.summary || 'done', r.details);
      st.ms = Date.now() - t;
      return r.value;
    } catch (e) {
      const st = this.add(name, 'fail', e.message);
      st.ms = Date.now() - t;
      e.reported = true;
      throw e;
    }
  }

  markdown() {
    const worst = this.stages.some((s) => s.status === 'fail') ? 'FAILED' : this.stages.some((s) => s.status === 'warn') ? 'finished with warnings' : 'all stages OK';
    const out = [`# Pipeline report: ${this.slug}`, '', `Result: **${worst}** (${((Date.now() - this.t0) / 1000).toFixed(0)}s)`, '', '| # | Stage | Status | Time | What happened |', '|---|---|---|---|---|'];
    this.stages.forEach((s, i) => out.push(`| ${i + 1} | ${s.name} | ${ICON[s.status] || s.status} | ${(s.ms / 1000).toFixed(1)}s | ${String(s.summary).replace(/\|/g, '/')} |`));
    for (const s of this.stages) {
      if (!s.details.length) continue;
      out.push('', `## ${s.name}`, ...s.details.map((d) => `- ${d}`));
    }
    return out.join('\n') + '\n';
  }

  save(dir) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${this.slug}-report.md`), this.markdown());
      fs.writeFileSync(path.join(dir, `${this.slug}-report.json`), JSON.stringify({ slug: this.slug, stages: this.stages }, null, 2));
      if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, this.markdown() + '\n');
    } catch (e) {
      console.warn('  could not write report: ' + e.message);
    }
  }
}

module.exports = { Report };
