export default function TermsPage() {
  return (
    <div className="shell">
      <div className="stack">
        <div className="brand">
          <div className="brand-name">Endgame</div>
          <div className="brand-sub">Event terms — Round 1</div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <span className="eyebrow">Terms and conditions</span>
          </div>
          <p className="hint">
            These terms apply to participation in ENDGAME Round 1, “The Mainframe”, a college fest competition. By
            scanning a team QR code and entering your name you accept them.
          </p>

          <h2 className="title-md" style={{ marginTop: 18 }}>1. Eligibility and teams</h2>
          <p className="muted">
            The round is played in 8 teams of 4 players (32 participants). A participant joins exactly one team by
            scanning that team’s QR code. A team is complete only when all four members have joined.
          </p>

          <h2 className="title-md" style={{ marginTop: 16 }}>2. Fair play</h2>
          <p className="muted">
            Each player receives one private puzzle. Sharing another player’s puzzle, using a second device to view
            someone else’s screen, manipulating device clocks, tampering with browser storage, calling the APIs
            directly, or attempting to impersonate a team leader is cheating and results in elimination. All
            submissions are validated on the server and recorded with timestamps.
          </p>

          <h2 className="title-md" style={{ marginTop: 16 }}>3. Leader and submissions</h2>
          <p className="muted">
            The team leader is selected automatically by the server. Only that participant can submit the final
            four-token sequence. Feedback reports only the number of correct and incorrect positions; it does not
            reveal which positions matched.
          </p>

          <h2 className="title-md" style={{ marginTop: 16 }}>4. Timing</h2>
          <p className="muted">
            Round 1 runs for 10 minutes from the server-side start time. The clock cannot be paused, extended or
            altered by participants. When time expires, all answers and final submissions are locked.
          </p>

          <h2 className="title-md" style={{ marginTop: 16 }}>5. Devices and network</h2>
          <p className="muted">
            Participants provide their own phones and are responsible for their device, battery and network
            connectivity. Progress is stored on the server: refreshing, closing the tab or losing signal does not
            reset your progress or the timer. Rejoin by scanning the same team QR code.
          </p>

          <h2 className="title-md" style={{ marginTop: 16 }}>6. Elimination</h2>
          <p className="muted">
            The four fastest teams that complete the round qualify; the remaining four are eliminated. Rankings are
            calculated from recorded completion times and attempt records and are final.
          </p>

          <h2 className="title-md" style={{ marginTop: 16 }}>7. Data we store</h2>
          <p className="muted">
            Display name, team, player slot, puzzle answers and attempt results, final submissions, connection and
            completion timestamps, and an internal audit log of game events. No passwords, payment details or
            contact details are collected from participants. Data is used only to run the event and is retained for
            organisational review by the event team.
          </p>

          <h2 className="title-md" style={{ marginTop: 16 }}>8. Organiser authority</h2>
          <p className="muted">
            The event organiser may restart, pause or end the round, correct configuration errors, and disqualify a
            team for rule violations. Decisions of the organising team during the event are final.
          </p>

          <p className="hint" style={{ marginTop: 18 }}>
            Questions? Ask an event volunteer at the venue. These terms describe the event rules for ENDGAME Round 1
            and are not a legal contract with any company.
          </p>
        </div>

        <a href="/" className="center" style={{ display: 'block' }}>
          Back
        </a>
      </div>
    </div>
  );
}
