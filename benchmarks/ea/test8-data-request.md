# EA Tests 8A/8B — route to the data, licence finding, and the request to send

**Status: NOT SENT, by board decision (2 November 2026).** No request goes to the Environment Agency or anyone
outside SPARC Labs. This file is kept as the record of the route, the drafted text and the licence findings, so the
work does not have to be redone if that decision ever changes. Until it does, Tests 8A/8B are unavailable to the
programme, and the OGL v3 reading of the Tests 1-7 inputs stays unconfirmed (finding A).
**Owner:** Validation & Benchmarking Lead. **Ticket:** SPA-92. **Date of research:** 1 November 2026.
**Nobody outside SPARC Labs has been contacted.**

**Revision 2 (after review).** The email was cut from 538 to 370 words; the offer to sign a data licence and to
cover supply costs was removed, because it committed the company to terms and fees nobody has approved; the
paragraph raising the Zenodo copy with the EA was removed (§2 explains why); the claim that we intend to publish
the solver permissively was removed, because `origin/main` has since merged a proprietary `LICENSE` that
contradicts it (finding C); and finding A now states plainly that the OGL v3 reading of the Tests 1–7 inputs is
unconfirmed. All five licence questions are retained, and the sender block is still placeholders.

Tests 8A and 8B are the only tests in the EA 2D benchmark suite (SC120002) that exercise rain-on-grid and a
surcharging pipe discharging to the surface — FloodSim's core use case. They are the one gap in our Gate B
record (`benchmarks/ea/README.md`: 88/94 measures, Tests 1–7 only).

---

## 1. What is actually published, verified today

I downloaded and listed the official archive rather than trusting the page text.

**`Benchmarking_Model_Data.zip`** — the "Benchmarking Model Data (51MB ZIP)" attachment on the GOV.UK SC120002
publication page, fetched 1 Nov 2026 from
`https://assets.publishing.service.gov.uk/media/6033a9bbd3bf7f72182e99ca/Benchmarking_Model_Data.zip`
(52,456,734 bytes, SHA-256 `388c2789570e5975fe909033e34bedbe5d7bde5e6d7f9b7d7c1eaf04e58bc732` — matches the
hash pinned in `benchmarks/ea/README.md`). Full contents:

| Entry | Bytes |
|---|---|
| Test1_dataset_2010.zip | 84,587 |
| Test2_dataset_2010.zip | 3,339,300 |
| Test3_dataset_2010.zip | 91,265 |
| Test4_dataset_2010.zip | 59,757 |
| Test5_dataset_2010.zip | 1,139,437 |
| Test6_dataset_2010.zip | 92,981 |
| Test7_dataset_2010.zip | 48,131,417 |
| XS info Tests_5&6.zip | 80,643 |

**There is no Test 8A or Test 8B entry.** Confirmed: the data for the two tests we need is not in the published
archive. I also checked the other two EA publication pages that carry this project and found no 8A/8B data:

- The 2013 "Research and analysis" page for the same report lists 20 attachments; its only ZIP
  (`LIT_8570_a3d694.zip`, 7,972,945 bytes) contains just `SC120002 report.pdf` and `SC120002 summary.pdf`.
  Verified by download and listing.
- The SC080035/SR2 (2010) report PDF carries no data attachment.

**What we are missing is only the input data.** The full test specification is already public: Appendix A.8 and
A.9 of the SC120002 report give the geometry, boundary conditions, roughness categories, output points and the
exact file manifests. From §A8.6 and §A9.6, the datasets should contain:

| Test 8A | Test 8B |
|---|---|
| `Test8DEM.asc` (0.5 m ASCII DEM) | `Test8DEM.asc` |
| `Test8A-rainfall.csv` (hyetograph) | `Test8B-pipe-inflow.csv` (culvert u/s discharge) |
| `Test8A-point-inflow.csv` | `Test8BPipeGeometry.xls` |
| `Test8A-inflow-location.csv` | `Test8Output.csv` |
| `Test8Output.csv` | `Test8Road_Pavement_polyg_region` (shapefile) |
| `Test8Road_Pavement_polyg_region` (shapefile) | `Test8RoadPavement.asc` |
| `Test8RoadPavement.asc` | `Test8Buildings_polyg_region` (shapefile) |
| | `Test8Buildings.asc` |

### Correction to a claim we have been making

`benchmarks/ea/README.md` said the data is "not published; **EA supplies on request**". The first half is now
verified. **The second half is unsourced.** I could find no EA statement — not in the SC120002 report, not in the
SC080035/SR2 report, not on either GOV.UK publication page — offering the 8A/8B data on request, and no form,
portal or named data-request mechanism for it. There is no documented route. The route below is one we have to
open ourselves. I have corrected the README to say this.

Independent corroboration that the data is unobtainable through published channels: the ANUGA project hit the
same wall and recorded it in
[anuga-community/anuga_core#478](https://github.com/anuga-community/anuga_core/issues/478) ("Blocker: the data is
not public"), concluding the next step is to ask the EA or the report authors. That issue is open with no reply
recorded — i.e. no evidence anyone has successfully obtained this data through a request.

## 2. A complete third-party copy exists — and it is a licence trap, not a shortcut

Zenodo record **10.5281/zenodo.15256842**, "Benchmarking of 2D Hydraulic Modelling Packages: files", deposited
**21 April 2025**, contains `Test8A_dataset_2010.zip` (2,342,624 bytes, MD5
`46b589ee000ff87c9077fcc51fa71e8e`) and `Test8B_dataset_2010.zip` (2,490,890 bytes, MD5
`84b865cedd28f8156cfe70b84004b62c`).

A wording caution, because it matters to how this record may be described: the deposit's *metadata* lists Gareth
Pender and Sylvain Néelz as creators. That is a field an uploader types, not a verified attribution, and the
depositing account is a different and unidentified party (below). This record should therefore never be described
as "credited to the report's authors" in anything we send or publish — it is an anonymous re-upload whose
metadata names them.

I listed both archives. They are the genuine article: every file in the §A8.6 and §A9.6 manifests above is
present, plus the original specification PDFs `EA2DTest8A - May2010.pdf` and `EA2DTest8B - May2010.pdf`.

**Do not build the validation record on this copy.** Three reasons, in order of seriousness:

1. **No licence at all.** The Zenodo API returns `license: null` and `rights: null`. The record is open-access
   but carries no grant of any kind. "Downloadable" is not "licensed", and a permissively licensed solver plus a
   public validation record is exactly the use case a missing licence does not cover.
2. **Third-party deposit, not an EA release.** The depositor is an unidentified Zenodo account (owner id 23832),
   not the Environment Agency and not visibly the credited authors. The description states it is an
   "alternative to the archived dataset" and points at a Wayback capture of the retired EA evidence site
   (`evidence.environment-agency.gov.uk/.../Benchmarking_Model_Data.sflb.ashx`). It is a re-upload. Whoever
   deposited it was not in a position to license it, so it conveys nothing.
3. **It is not the current official bundle.** Zenodo's `Test7_dataset_2010.zip` is 31,049,730 bytes; the live
   GOV.UK bundle's is 48,131,417 bytes. The mirror is an older revision of the archive. We therefore cannot
   assume its 8A/8B contents are what the EA would supply today, and we would be pinning our benchmark to an
   unverifiable snapshot.

**It is not mentioned in the email, by review decision.** My first draft raised it with the EA as leverage — a
copy is circulating without licence terms, so release it properly. That paragraph has been cut: it described an
anonymous upload as being credited to the report's authors, which we cannot stand behind, and pointing a public
authority at an unlicensed copy of its own data invites a conversation about that copy rather than about our
request. The record stays here as an internal finding only: it tells us the files exist in the form the report
describes, and it is why we can be specific about what we are asking for.

## 3. Licence consequence — flagged before the request goes out

This is item 3 of the ticket and it is the part the programme needs to decide on.

### Finding A — the data we already publish results from may not be OGL v3

We state in `benchmarks/ea/README.md` and in `benchmarks/ea/cases.mjs` that the benchmark data is under Open
Government Licence v3. That rests only on the GOV.UK page footer, "All content is available under the Open
Government Licence v3.0, **except where otherwise stated**". The SC120002 report itself states otherwise, on its
inside front cover:

> "© Environment Agency – August 2013. All rights reserved. This document may be reproduced with prior
> permission of the Environment Agency."

The data archive carries no licence statement of its own, anywhere. So the OGL claim for the benchmark inputs is
an inference from a page footer that is expressly qualified, and it sits next to an all-rights-reserved notice on
the companion document. **This affects Tests 1–7, which we have already run and published, not just 8A/8B.**

**Stated plainly: the Open Government Licence v3 reading of the Tests 1–7 inputs is unconfirmed, and it stays
unconfirmed until the Environment Agency answers. Until they do, nothing we publish may rely on it.** In
practice that means we do not describe the benchmark inputs as OGL v3 in the README, in `cases.mjs`, in the
validation record or in any customer-facing material; where the licence has to be mentioned, we state the basis
(a qualified page footer, an all-rights-reserved report, no licence statement on the archive) and label it
unconfirmed. I have already changed both repo sites to do that. We also continue not to redistribute the
archive — users fetch it from GOV.UK themselves — which is what keeps the current exposure to a description
problem rather than a distribution one.

The request below asks the EA to confirm the position for the whole archive, which closes the exposure for the
published record at the same time as opening the route to 8A/8B. That is the main reason to send it even if
8A/8B were to fall through.

### Finding B — the 8A/8B inputs probably contain third-party IP, and that is likely why they were never published

Two of the inputs are the problem:

- **The DEM.** Per §A8.2 and §A9.2, `Test8DEM.asc` is a 0.5 m bare-earth DTM "created from LiDAR data collected
  on 13 August 2009 and provided by the Environment Agency (http://www.geomatics-group.co.uk)". In 2009 EA
  Geomatics Group licensed LiDAR commercially; EA LiDAR only moved to open OGL release later, under the National
  LiDAR Programme. A 2009 Geomatics tile is not automatically covered by that.
- **The road/pavement and building outlines.** `Test8Road_Pavement_polyg_region` and
  `Test8Buildings_polyg_region` are vector outlines of real streets and real buildings in Glasgow. Their source
  is not stated anywhere in the report. The most likely provenance is Ordnance Survey (MasterMap-class) data,
  which is licensed and whose derived products carry redistribution restrictions. The ANUGA maintainer reached
  the same conclusion independently in issue #478 ("probably Ordnance Survey data under licence").

The site is Cockenzie Street, Glasgow — in Scotland, outside the EA's England remit, which makes the provenance
chain for these layers worth asking about explicitly rather than assuming.

**Consequence for Position C, stated plainly:** if either layer is third-party licensed, the likely outcome is
that the EA can let us *use* the data to run the test but not *redistribute* it. That is survivable and does not
block Position C, provided we design for it now:

- The data's terms do not constrain how we licence the solver either way: it is an input, not part of the solver.
  So whichever way the Position C / proprietary-`LICENSE` conflict in finding C is settled, the EA's answer does
  not decide it.
- We can publish the *results* — scores, probe series, depth maps, mass books, and the misses — as our own work,
  as we already do for Tests 1–7. Derived numeric results are ordinarily fine; **but confirm this in writing**,
  because a restriction on publishing results derived from the data would directly contradict our commitment to
  publish a validation record including failures.
- We must **not** commit the 8A/8B input files to the public repo, and must not assume we can, unlike the
  Tests 1–7 inputs which users currently fetch from GOV.UK themselves. The reproduce instructions for 8A/8B would
  have to tell users to request the data from the EA themselves. That is a worse reproducibility story and the
  programme should know it is the probable end state.
- **The one answer that would be a genuine problem** is a restriction on publishing derived results, or a
  research-use-only grant that excludes commercial use. Both are plausible and both are asked about directly in
  the request. If either comes back, the honest options are to run 8A/8B as an internal check we cannot publish,
  or to drop it and state in the validation record that the suite's only rain-on-grid-plus-sewer test is
  unavailable to us on licence grounds. **That decision belongs to the programme, not to me**, and it cannot be
  made before the EA answers.

### Finding C — the repo's licence now contradicts Position C, so the request claims nothing about it

This finding changed while the ticket was in review, and it changed what the email may say.

When I first drafted the request there was no `LICENSE` file and no `license` field in `package.json`, so I wrote
that we *intend* to publish the solver core under a permissive licence — accurate at the time, given Position C.
That is no longer accurate. `origin/main` now carries commit `c178700` ("Add proprietary LICENSE and an explicit
`package.json` license field", PR #1), which adds a `LICENSE` reading:

> "Proprietary License … This software and its associated documentation are the proprietary and confidential
> property of SPARC Labs LLC … No licence to use, copy, modify, publish or distribute the Software is granted by
> this file or by access to this repository."

and sets `"license"` in `package.json` to match. **The repository's recorded licence is now the opposite of
Position C.** I have not touched either file: changing a licence file is explicitly a stop-and-ask on this
ticket, and reconciling the two is a programme decision, not mine.

The consequence for this ticket is narrow and I have acted on it: **the drafted email no longer says anything
about how we will licence the solver.** Telling a public authority we intend to publish permissively, while the
repo states that no licence to publish or distribute is granted, would be a false statement to a regulator in
writing, and it would be the EA's own data request that it was attached to. The email now says only what is
verifiable — that we are a private company building a model for commercial use, and that we publish a validation
record including failures. Neither claim depends on which way the licence question lands. Note the new `LICENSE`
also states that "Environment Agency benchmark data is used under its own terms and is not redistributed by this
license", which is consistent with finding A and with what the email asks.

**For the programme, not for me to settle:** Position C (publish the solver core permissively) and the merged
proprietary `LICENSE` cannot both stand. This does not block sending the request — the request is silent on it —
but it should be resolved before anything is published as open source, and whoever sends the email should know
not to volunteer a licensing intention on the company's behalf in a reply.

## 4. The route I recommend

No form and no portal exists. The route is an email to the programme that owns the output, with a statutory
fallback.

**Primary — FCERM Research and Development Programme, Evidence Directorate, Environment Agency.**
**`fcerm.evidence@environment-agency.gov.uk`**

Sourced from the primary document: the inside front cover of the SC120002 technical report gives
"Published by: Environment Agency, Horizon House, Deanery Road, Bristol, BS1 9AH … Email:
fcerm.evidence@environment-agency.gov.uk", and names the project as SC120002, dissemination status "Publicly
available", research contractor Heriot-Watt University. This is the mailbox for the programme that commissioned
and owns the work, so it is the correct first destination. (The report also names a 2013 EA project manager in
the Evidence Directorate. **Do not address him personally** — thirteen years on it is very likely stale, and a
named individual who has moved on is a dead letter where a programme mailbox is not.)

**Secondary, if the programme mailbox does not respond —** EA National Customer Contact Centre,
`enquiries@environment-agency.gov.uk`, 03708 506506. This is the general enquiries route given on the same page
of the report and on the GOV.UK publication page.

**Statutory fallback.** The EA is a public authority and this is recorded environmental information it holds.
A request under the Environmental Information Regulations 2004 must be answered within **20 working days**.
I would not open with this — it converts a collegiate request into a compliance matter and makes a licence
negotiation harder — but it is the backstop if the first two routes go quiet, and it is the reason a
no-response outcome is not final.

**Worth doing in parallel, with approval:** the report's authors, Sylvain Néelz and Gareth Pender (Heriot-Watt
University, the named research contractor), built the datasets. They are the fastest plausible source of the
files themselves and of the provenance of the building and road outlines. They cannot grant a licence to EA
project output, so this supplements the EA request and does not replace it. Contacting them is outside this
ticket's hard limit, so I have not looked up addresses; flag it if you want it drafted.

## 5. Expected lead time — unknown

Stated honestly, as the acceptance criteria require: **I do not know, and I found nothing to base an estimate
on.**

- The EA publishes no service standard for FCERM research-data requests, because there is no documented request
  process to attach one to.
- There is no public record of anyone successfully obtaining the 8A/8B data this way. The one documented attempt
  to try (ANUGA issue #478) has no reply on it.
- The only bounded number in the whole route is the **20 working days** that EIR 2004 imposes, and that applies
  only if we escalate to a formal information request.
- The request asks for a dataset from a project that closed in 2013 and whose named contact has very likely
  moved on, so it may need internal routing before anyone who knows what it is sees it.

Planning assumption I would use, flagged as a guess and not evidence: allow **one to three months** through the
collegiate route, and treat silence after three weeks as the trigger to chase and then to consider EIR. The
reason this was made a day-one ticket holds up — the lead time is genuinely outside our control and could be
long.

---

## 6. The request, ready to send

The sender fills in the bracketed identity fields. Nothing else needs rewriting. The body is **370 words**,
down from 538 in the first draft (counted "Dear …" to "Many thanks for your help.").

**To:** fcerm.evidence@environment-agency.gov.uk
**Subject:** Request for Test 8A/8B datasets — FCERM project SC120002 (2D benchmarking)

> Dear FCERM Evidence team,
>
> I am writing to request the Test 8A and Test 8B input datasets from FCERM project SC120002 (2D hydraulic
> modelling benchmarking, Néelz and Pender, 2013), and to ask what licence terms apply.
>
> **Who we are.** SPARC Labs is a private company building a GPU flood model for commercial use by planners and
> engineers; we have no academic affiliation. Our validation record reports the model's failures as well as its
> successes.
>
> **What we are asking for.** The Test 8A and 8B input data: all files listed in sections A8.6 and A9.6. We have
> the Appendix A specifications, so we need only the data. The published "Benchmarking Model Data" archive on the
> project's GOV.UK page holds Tests 1 to 7 only, and we found no other source.
>
> **What we would do with it.** Run both tests at the specified resolutions and publish the results against the
> ranges SC120002 reports, as we have for Tests 1 to 7. These are the suite's only tests combining rainfall on
> the grid with a surcharging pipe, the case our model is built for.
>
> **The questions we need answered.** So that we neither misuse the data nor misstate its provenance, please
> confirm:
>
> 1. Under what licence or terms the datasets would be supplied, and whether commercial use is permitted.
> 2. Whether we may publish model results derived from the data in a public validation record, and what
>    attribution you require.
> 3. Whether we may redistribute the input files themselves. We assume not, and will not unless you confirm
>    otherwise.
> 4. Whether third-party rights attach to any part of the data — specifically the 0.5 m LiDAR DEM, attributed to
>    EA Geomatics Group (survey of 13 August 2009), and the Glasgow road, pavement and building outlines, whose
>    source the report does not state.
> 5. The licence position for the published Tests 1 to 7 archive, which we already use: the GOV.UK footer gives
>    Open Government Licence v3.0 "except where otherwise stated", the report is marked "All rights reserved",
>    and the archive itself carries no licence statement.
>
> If another team or the research contractor now holds this data, please forward this request or tell us where to
> direct it. We would be glad to discuss any terms.
>
> Many thanks for your help.
>
> Yours sincerely,
>
> [Name]
> [Job title], SPARC Labs
> [Email] · [Phone]
> [Company address]

### Notes for the sender

- **The bracketed fields stay bracketed until the board names a sender.** I have not filled them in and should
  not.
- Send from a company address. The email says we are a commercial operation; a personal address undercuts it.
- The five numbered questions are the deliverable's real value — **do not drop them to shorten the email.**
  Question 3 protects us from assuming redistribution rights we will not get, and question 5 closes a live gap in
  the record we have already published.
- **The email commits the company to nothing.** It does not offer to sign a data licence or agreement, does not
  offer to pay a supply cost, and says nothing about how we licence our own software — see finding C. "We would
  be glad to discuss any terms" is deliberate: it keeps the door open without agreeing to anything. If the EA
  proposes terms or a fee, that comes back for approval rather than being accepted in a reply.
- If the EA replies restricting publication of derived results, or granting research-use-only, **stop and bring
  it back to the programme.** That answer changes what the validation record can contain and is a programme
  decision.
- Log the date sent, so the three-week chase and the EIR fallback have a clock to run against. I will track it
  against this document.
