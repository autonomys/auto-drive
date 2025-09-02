import { redirect } from 'next/navigation';

export default function Page({
  params: { chain },
}: {
  params: { chain: string };
}) {
  redirect(`/${chain}/drive/global`);
}
