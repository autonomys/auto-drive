import { PurchaseCredits } from '@/components/views/PurchaseCredits';

// The purchase screen is intentionally available to all visitors — including
// unauthenticated and non-Google users — so the credit packages are
// discoverable. Authentication is enforced at the point of action: selecting a
// package prompts a Google sign-in (see Step1_SelectPackage / GoogleAuthGate).
export default function Page() {
  return <PurchaseCredits />;
}
