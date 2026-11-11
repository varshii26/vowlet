import { AccountMenu } from "@/components/Account/AccountMenu";
import { auth } from "@/lib/auth";
import { idleMinutes } from "@/lib/demo/auto-reset";

/** The account avatar and menu for whoever is signed in, or nothing when signed out. Server side: it reads the session. */
export async function AccountHeader() {
  const user = (await auth())?.user;
  if (!user?.id) return null;
  return (
    <AccountMenu
      name={user.name ?? null}
      email={user.email ?? null}
      image={user.image ?? null}
      isDemo={user.isDemo}
      idleMinutes={idleMinutes(process.env.DEMO_AUTO_RESET_MINUTES)}
    />
  );
}
