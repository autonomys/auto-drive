export const Toggle = ({
  value,
  onUpdate,
}: {
  value: boolean;
  onUpdate: (isOn: boolean) => void;
}) => {
  return (
    <button
      className={`h-6 w-12 rounded-full p-[2px] transition-colors duration-300 ease-in-out focus:outline-none focus:ring-1 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background ${
        value ? 'dark:bg-darkBlack bg-black' : 'bg-gray-200'
      }`}
      onClick={() => onUpdate(!value)}
      aria-pressed={value}
    >
      <span
        className={`block h-4 w-4 transform rounded-full bg-background shadow-md transition-transform duration-300 ease-in-out ${
          value ? 'translate-x-6' : 'translate-x-0'
        }`}
      />
    </button>
  );
};
