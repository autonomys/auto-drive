export const IconWithTooltip = ({
  icon,
  tooltip,
}: {
  icon: React.ReactNode;
  tooltip: string;
}) => {
  return (
    <div className='group relative inline-flex items-center'>
      {icon}
      <div className='invisible absolute bottom-full left-2 z-10 mb-1 -translate-x-1/4 whitespace-nowrap rounded bg-gray-800 px-2 py-1 text-xs text-white opacity-0 transition-opacity duration-200 group-hover:visible group-hover:opacity-100'>
        {tooltip}
        <div className='absolute left-1/4 top-full border-4 border-transparent border-t-gray-800'></div>
      </div>
    </div>
  );
};
