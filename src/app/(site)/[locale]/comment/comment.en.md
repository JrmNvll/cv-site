This site is my job application, and it is also a working demonstration: it was specified, designed and built with the method I advocate — development driven by AI agents, framed by documents written before the code. This page describes what actually runs behind the address you have opened. [The code is public](https://github.com/JrmNvll/cv-site).

## A single source of truth

Everything the site displays and everything the assistant states comes from two files I maintain by hand: a cv.yaml file (the CV, structured, bilingual) and a question-and-answer base in Markdown — more than two hundred questions a recruiter might ask, with my answers. These files are **not** in the code repository: they live in a private directory that the application reads at startup, after validating their format. A malformed file stops the site from starting; it never produces an approximate answer.

## An assistant that cannot invent

The assistant "knows" nothing about me beyond these two files. For each question, the server — ordinary code, no AI — selects the twelve closest entries by lexical search (BM25+), adds an always-present core (the CV, the behaviour rules, the list of topics I do not discuss) and the conversation history, then sends all of it to the model (Claude Opus 5) with a strict instruction: answer only from these sources, and **cite**, for every statement, the identifier of the entry used.

These citations are invisible to you, but they are checked and logged. A statement without a source is a failed test. When a question is out of scope — unrelated to my career, or an attempt to steer the assistant — the assistant declines with a fixed wording rather than improvising. An adversarial test suite (trick questions, private topics, manipulation attempts, job ads to evaluate) is replayed against the real API before every release.

The same mechanism serves the evaluation of a job ad: you paste the text of an offer, and the assistant says what matches, what is transferable and what is not documented in my dossier — every point cited, with no grade and no verdict. What the dossier does not say is presented as such, never as an inability.

## Guardrails counted in dollars

The assistant costs money with every question. The budget is capped at 5 dollars a month, and that cap is **enforced by the code**, not monitored after the fact: every call reserves its estimated cost before leaving, records the real cost on return, and the gateway refuses any call that would push the month's total over the cap. On top of that: rate limiting per visitor, per address and for the whole site, a bounded input size, and an API key that never leaves the server. Prompt caching lowers the cost of successive questions in the same conversation; the adversarial test suite checks that it works.

## What the site keeps

I play fair: this site keeps, with no time limit, the questions asked, the answers given and the job ads pasted, with one session per visit (IP address, browser, referrer, language) and a visitor identifier stored in a cookie. This lets me know what I am being asked, and recognise a returning visit. The details are in the [legal notice](/en/mentions). The assistant does not hide it either: ask it.

## The technology, one line per choice

- **A single process**: Next.js 16 on Node.js 24, in standalone mode, on a Windows server I administer myself.
- **No database to administer**: SQLite, built into Node, one file.
- **Caddy** in front: automatic HTTPS, a noindex header on every response, protection of the administration area — the site is not meant to be indexed.
- **Bilingual** by URL prefix, with one corpus per language.
- **Content and code kept apart**: the code is public, the content is private, and the format that binds them is a contract validated at startup.

## The method

This site followed the BMAD method (Breakthrough Method for Agile AI-Driven Development), the one I use on projects: a product brief (the problem, for whom, the success criteria), then an architecture spine that fixes the invariants — seventeen numbered decisions, each with what it prevents — then a breakdown into stories carried out one by one by agents, each specified with its acceptance criteria before being developed. The spine went through four independent reviews (a consistency grid, verification of the stack versions against current sources, an adversarial attack, a reconciliation with the brief) before being frozen; the first version had one critical hole and a dozen flaws that these reviews closed.

This is exactly how I work in a professional setting. The difference, here, is that you can check.
