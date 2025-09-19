export const Section = ({
  title,
  children,
}: {
  title: React.ReactNode;
  children: React.ReactNode;
}) => {
  return (
    <section className='flex flex-col gap-3 rounded-lg border p-6'>
      <h2 className='text-lg font-semibold'>{title}</h2>
      {children}
    </section>
  );
};
