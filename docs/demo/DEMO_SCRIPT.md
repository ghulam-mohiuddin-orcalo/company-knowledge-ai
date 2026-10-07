# Demo Script (3–4 minutes)

A deterministic walkthrough of the MVP (E9-T04): upload → Ready, grounded answer with a citation, an unknown question, and admin/member permissions. The same path is automated as the deployment smoke test (`tests/e2e/deploy/demo-path.spec.ts`), so it is verified on every release.

## Before the demo (once per environment)

1. The environment is deployed (docs/deployment/RUNBOOK.md) and `smoke.sh` passes.
2. A demo organization with one admin and one member exists:
   - Rehearsal/local: created automatically by `pnpm deploy:rehearsal up` (`demo-admin`, `demo-member`); for the dev stack use `pnpm db:seed:demo`.
   - Hosted staging: `docker compose run --rm provision --organization 'Demo Organization' --admin '<admin-sub>:<email>' --member '<member-sub>:<email>'` with two IdP test users.
3. The organization has **no** documents named like the samples (the automated run deletes them at the end). Have the two sample files ready to upload: [`documents/Northwind Employee Handbook.txt`](documents/Northwind%20Employee%20Handbook.txt) and [`documents/IT Security Policy.txt`](documents/IT%20Security%20Policy.txt).
4. Open two browser windows: a normal one for the admin and a private one for the member (sessions are per window).

Answers in the steps below are exact with the rehearsal's deterministic AI stand-in. With a real model the wording varies, but the facts and the cited documents are the same.

## Path

| # | Who | Do | Show / expected |
| --- | --- | --- | --- |
| 1 | Admin | Sign in. | Dashboard with the organization name; role "Organization admin"; navigation includes Documents and Organization. |
| 2 | Admin | **Documents** → upload both sample files. | Each appears immediately as *Queued/Processing*, then *Ready* within seconds (the list refreshes by itself). Point out type, size, uploader. |
| 3 | Admin | **Ask a question** → "How many days of annual leave do full-time employees receive?" | Answer: full-time employees receive **25 days of annual leave** per year, with citation **[1]** and the source *Northwind Employee Handbook.txt* listed under the answer. |
| 4 | Admin | Click the citation. | Source panel: document name, location and the exact cited passage; *Download original* gets the private file through the API. Close with Esc. Point out: citations come from what was retrieved, never from the model. |
| 5 | Member | Sign in (private window). | Role "Member"; no Organization page. **Documents** shows both files *Ready* but no upload control and no Delete buttons. |
| 6 | Member | **Ask a question** → "How do I report a lost or stolen laptop?" | Answer: report it to the IT Service Desk within one hour by calling **extension 4357**, citing *IT Security Policy.txt*. |
| 7 | Member | Ask "Who won the football World Cup in 1966?" | The explicit **no-answer** response: the knowledge base does not contain this. The assistant does not fall back to general knowledge. |
| 8 | Admin | (Optional) **Documents** → Delete *Northwind Employee Handbook.txt* → confirm. Ask question 3 again in a new conversation. | Deletion needs confirmation; afterwards the question gets the no-answer response: deleted content is no longer used. Earlier citations show "no longer available". |

Talking points: every organization's documents, conversations and citations are isolated (tenant-scoped on the server, tested on every change); members cannot change documents even by calling the API directly (step 5 of the automated path checks the server returns 403); the whole flow runs over HTTPS on the deployed environment.

## Reset after the demo

Delete the two sample documents as admin (Documents → Delete). Conversations remain with their owners; citations of deleted documents show as unavailable.
