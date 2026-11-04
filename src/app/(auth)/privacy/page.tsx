import type { Metadata } from "next";
import type { ReactNode } from "react";
import { LinkButton } from "@/components/ui";
import { BrandLockup } from "@/components/layout/brand-mark";
import styles from "./privacy.module.css";

/**
 * The privacy policy, public at /privacy: the address given to Apple and
 * Google, and linked from sign in and the phone app's menu.
 *
 * <p>Written from what the code actually does (checked Nov 2026): no
 * location, no biometrics, no analytics, the service providers named below.
 * A change to any of those means this page changes in the same commit.
 */

export const metadata: Metadata = {
  title: "Privacy Policy · CloudTime",
  description: "How CloudTime handles the information of the people who use it.",
};

const UPDATED = "November 4, 2026";
const COMPANY = "Cloudx Systems LLC";
const ADDRESS = ["5903 West Side Ave", "North Bergen, NJ 07047"];
const PRIVACY_EMAIL = "datasecurity@cloudxsystems.net";

const SECTIONS: { id: string; title: string; body: ReactNode }[] = [
  {
    id: "employer",
    title: "Your employer's role",
    body: (
      <>
        <p>
          CloudTime is something your employer pays for and sets up. Your employer creates your account, decides which
          features are switched on, and decides what information about you goes into CloudTime. We run CloudTime on your
          employer&apos;s behalf and use that information only to provide the service to them.
        </p>
        <p>
          In privacy law terms, your employer is the business (or controller) responsible for your information, and
          Cloudx is its service provider (or processor). If you have a question about why something is recorded, or you
          want to see, correct or delete your information, your employer&apos;s HR team is the best place to start. You can
          also contact us, and we will pass your request on.
        </p>
      </>
    ),
  },
  {
    id: "collect",
    title: "Information we collect",
    body: (
      <>
        <p>What CloudTime holds about you depends on which features your employer uses. It can include:</p>
        <dl>
          <dt>Profile and job details</dt>
          <dd>
            Your name, username, work and personal email addresses, phone numbers, employee code, badge number, and the IDs
            your employer&apos;s payroll and warehouse systems use for you. Your site, department, shift, supervisor, job
            title, agency, and start and leaving dates. If your employer records them, also your date of birth, home
            address, emergency contact, gender, marital status and preferred language.
          </dd>
          <dt>Pay details</dt>
          <dd>If your employer uses CloudTime for payroll, your pay type and pay rates.</dd>
          <dt>Time and attendance</dt>
          <dd>
            Your clock ins and clock outs, breaks, schedules, timesheets, missed punches and corrections, with the notes
            and approvals attached to them. If your building has security gates connected to CloudTime, the time and place
            of each badge scan.
          </dd>
          <dt>Time off</dt>
          <dd>
            Your requests, their dates and hours, any note you or your approver add, and your balances. Some employers turn
            off notes on sick leave requests so that no medical details are entered at all.
          </dd>
          <dt>Photos</dt>
          <dd>A photo of you, taken at a time clock or added by your employer, so staff can see who is badging in.</dd>
          <dt>Documents</dt>
          <dd>Files your employer attaches to your record.</dd>
          <dt>Sign in details</dt>
          <dd>
            Your password, stored only in a scrambled form that cannot be turned back into the password. If you sign in with
            Google, the basic account details Google shares for that. When a wrong password is typed, the time and the
            internet (IP) address it came from, so we can stop people guessing passwords.
          </dd>
          <dt>Activity records</dt>
          <dd>A log of who changed or downloaded what in CloudTime, so your employer can see who handled a record.</dd>
          <dt>Phone app details</dt>
          <dd>
            If you allow notifications, the address Apple or Google gives your phone so notifications can reach it. It is
            removed when you sign out or turn notifications off.
          </dd>
          <dt>Help requests</dt>
          <dd>
            When you ask for help from inside CloudTime, your message, any files you attach, and your name, email, role and
            site, so our support team can answer you.
          </dd>
        </dl>
      </>
    ),
  },
  {
    id: "not-collected",
    title: "Information we do not collect",
    body: (
      <ul>
        <li>
          <strong>Location.</strong> CloudTime has no GPS or location features, and the apps never ask for access to your
          location.
        </li>
        <li>
          <strong>Biometric data.</strong> We do not collect fingerprints, face scans or any other biometric data. If you
          turn on Face ID or fingerprint unlock in the app, your phone does the check itself and only tells CloudTime
          whether it passed. Photos in CloudTime are never used for face recognition.
        </li>
        <li>
          <strong>Government ID numbers.</strong> CloudTime has no place for Social Security numbers or other government ID
          numbers.
        </li>
        <li>
          <strong>Advertising and tracking.</strong> CloudTime shows no ads and uses no analytics or tracking tools. We do
          not sell or rent personal information, and we do not share it for advertising.
        </li>
      </ul>
    ),
  },
  {
    id: "use",
    title: "How we use information",
    body: (
      <>
        <p>We use information only to provide CloudTime to your employer:</p>
        <ul>
          <li>to record time and work out hours, overtime and time off balances under your employer&apos;s rules;</li>
          <li>to let you, your supervisor and your employer&apos;s HR and payroll staff see and approve that information;</li>
          <li>to send the emails and phone notifications CloudTime offers, such as when a time off request is approved;</li>
          <li>to pass hours and staff details to the payroll, warehouse and other systems your employer connects;</li>
          <li>to keep CloudTime secure, prevent misuse and look into problems;</li>
          <li>to answer help requests and fix faults.</li>
        </ul>
        <p>We do not use your information for any other purpose, and we do not use it to train artificial intelligence.</p>
      </>
    ),
  },
  {
    id: "access",
    title: "Who can see your information",
    body: (
      <>
        <ul>
          <li>You can see your own details, hours and time off.</li>
          <li>Your supervisors can see the people who report to them.</li>
          <li>
            Your employer&apos;s HR, payroll and administrator staff can see the people and sites their role allows. Your
            employer decides these roles.
          </li>
          <li>A small number of Cloudx staff can reach your employer&apos;s data to set up, support and maintain CloudTime, and only for that.</li>
          <li>Systems your employer connects to CloudTime, such as payroll, receive what that connection needs.</li>
        </ul>
        <p>Coworkers who do not manage you cannot see your hours, pay or time off.</p>
      </>
    ),
  },
  {
    id: "providers",
    title: "Companies that help us run CloudTime",
    body: (
      <>
        <p>
          We use a few service providers. Each one handles information only to provide its service to us, and is bound to
          protect it.
        </p>
        <dl>
          <dt>Vercel</dt>
          <dd>Runs the CloudTime website and the server the apps connect to.</dd>
          <dt>Supabase</dt>
          <dd>Stores the CloudTime database and attached documents.</dd>
          <dt>Amazon Web Services</dt>
          <dd>Stores employee photos.</dd>
          <dt>Google</dt>
          <dd>Sign in with Google, and sending CloudTime emails.</dd>
          <dt>Twilio SendGrid</dt>
          <dd>Sends CloudTime emails when Google&apos;s service is not used.</dd>
          <dt>Apple and Google (Firebase Cloud Messaging)</dt>
          <dd>
            Deliver phone notifications. They receive the notification text, such as &ldquo;Your time off request was
            approved&rdquo;, and the phone&apos;s notification address.
          </dd>
        </dl>
        <p>
          When your employer turns on a connection, information also goes to that system: for example ADP for payroll, your
          employer&apos;s warehouse management system, or your employer&apos;s own software through CloudTime&apos;s API.
        </p>
        <p>
          We may also disclose information when the law requires it, to protect someone&apos;s safety, or as part of a sale
          or merger of our business, in which case this policy keeps applying to it.
        </p>
      </>
    ),
  },
  {
    id: "cookies",
    title: "Cookies",
    body: (
      <p>
        CloudTime uses a few small cookies and similar storage on your device, only to keep you signed in, protect sign in,
        and remember choices such as your filters, your theme and whether the app lock is on. There are no advertising or
        tracking cookies.
      </p>
    ),
  },
  {
    id: "app",
    title: "Phone app permissions",
    body: (
      <>
        <dl>
          <dt>Notifications</dt>
          <dd>Optional. Turn them off under Notifications in the CloudTime menu, or in your phone&apos;s settings.</dd>
          <dt>Camera</dt>
          <dd>Used only when staff with permission take an employee photo. The app asks before using it.</dd>
          <dt>Face ID, Touch ID or fingerprint</dt>
          <dd>An optional app lock, checked entirely on your phone. Turn it off under App lock in the CloudTime menu.</dd>
        </dl>
        <p>The apps do not ask for your location, contacts or microphone.</p>
      </>
    ),
  },
  {
    id: "retention",
    title: "How long we keep information",
    body: (
      <>
        <p>
          We keep information for as long as your employer uses CloudTime, unless your employer removes it sooner. Employers
          usually have to keep time and pay records for several years. US federal law requires at least two years for time
          cards and three years for payroll records, and some states require longer.
        </p>
        <ul>
          <li>Phone notification addresses are deleted when you sign out, turn notifications off, or remove the app.</li>
          <li>
            Some employers can anonymise people who have left: their name and contact details are removed, and only the hours
            and pay history the law requires are kept.
          </li>
          <li>When an employer stops using CloudTime, we handle its data as our agreement with that employer sets out.</li>
        </ul>
      </>
    ),
  },
  {
    id: "deletion",
    title: "Deleting your account",
    body: (
      <p>
        Your account belongs to your employer, so your employer is the one who can close it or delete your information. Ask
        your HR team. If you contact us instead, we will pass your request to your employer and help them with it. Your
        employer may need to keep some records, such as hours and pay, to meet the law.
      </p>
    ),
  },
  {
    id: "security",
    title: "How we protect information",
    body: (
      <>
        <ul>
          <li>Everything sent between your device and CloudTime is encrypted.</li>
          <li>Sensitive profile details, such as home address, phone numbers and emergency contact, are also encrypted where they are stored.</li>
          <li>Passwords are stored scrambled, and repeated wrong passwords lock sign in for a short time.</li>
          <li>Each person sees only what their role allows, and changes and downloads are logged.</li>
        </ul>
        <p>
          No system is perfectly secure. If we learn that personal information was reached without permission, we will tell
          your employer promptly, so the people affected can be told as the law requires.
        </p>
      </>
    ),
  },
  {
    id: "rights",
    title: "Your rights",
    body: (
      <p>
        Depending on where you live, you may have the right to know what information is held about you, get a copy, correct
        it, or ask for it to be deleted. Because your employer controls your information, send these requests to your
        employer, who can download a copy of everything CloudTime holds about you. If you send a request to us, we will pass
        it to your employer and help them answer it. No one is treated differently for asking.
      </p>
    ),
  },
  {
    id: "california",
    title: "California residents",
    body: (
      <p>
        If you live in California, the California Consumer Privacy Act gives you the rights above. Cloudx acts as a service
        provider to your employer. We collect the categories of information listed under Information we collect, for the
        purposes listed under How we use information. We do not sell personal information or share it for advertising.
        CloudTime holds some information California law calls sensitive, such as your sign in details, and uses it only to
        provide the service. Requests go to your employer, who is responsible for answering them, and you may use an
        authorized agent to make one.
      </p>
    ),
  },
  {
    id: "children",
    title: "Children",
    body: (
      <p>
        CloudTime is a workplace tool for employees. It is not meant for children under 13, and we do not knowingly collect
        information from them.
      </p>
    ),
  },
  {
    id: "changes",
    title: "Changes to this policy",
    body: (
      <p>
        If we change this policy, we will update the date at the top of this page. If a change is significant, we will tell
        your employer before it takes effect.
      </p>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <BrandLockup />
        <h1 className={styles.title}>Privacy Policy</h1>
        <p className={styles.updated}>Last updated {UPDATED}</p>
        <p className={styles.lead}>
          This policy explains what information CloudTime handles about the people who use it, why, and what choices you
          have. CloudTime is a time and attendance service made by {COMPANY} (&ldquo;Cloudx&rdquo;, &ldquo;we&rdquo;). It
          covers the CloudTime website and the CloudTime apps for iPhone and Android.
        </p>
      </header>

      <nav className={styles.contents} aria-label="Contents">
        <h2 className={styles.contentsTitle}>Contents</h2>
        <ol>
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`}>{s.title}</a>
            </li>
          ))}
          <li>
            <a href="#contact">Contact</a>
          </li>
        </ol>
      </nav>

      <main className={styles.body}>
        {SECTIONS.map((s) => (
          <section key={s.id} id={s.id} aria-labelledby={`${s.id}-title`} className={styles.section}>
            <h2 id={`${s.id}-title`} className={styles.sectionTitle}>
              {s.title}
            </h2>
            {s.body}
          </section>
        ))}

        <section id="contact" aria-labelledby="contact-title" className={styles.section}>
          <h2 id="contact-title" className={styles.sectionTitle}>
            Contact
          </h2>
          <p>Questions or requests about privacy can go to:</p>
          <address className={styles.address}>
            {COMPANY}
            {ADDRESS.map((line) => (
              <span key={line}>{line}</span>
            ))}
            <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a>
          </address>
        </section>
      </main>

      <footer className={styles.foot}>
        <LinkButton href="/" hierarchy="link" size="sm">
          Back to CloudTime
        </LinkButton>
      </footer>
    </div>
  );
}
