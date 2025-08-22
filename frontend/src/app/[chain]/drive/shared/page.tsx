'use client';

import { SharedFiles } from '@/components/views/SharedFiles';
import { UserProtectedLayout } from '../../../../components/layouts/UserProtectedLayout';

export default function Page() {
  return (
    <UserProtectedLayout>
      <SharedFiles />
    </UserProtectedLayout>
  );
}
