export const Toggle = ({
  value,
  onUpdate,
}: {
  value: boolean;
  onUpdate: (isOn: boolean) => void;
}) => {
  return (
    <button
      className={`w-12 h-6 rounded-full p-[2px] transition-colors duration-300 ease-in-out focus:outline-none focus:ring-1 focus:ring-offset-2 focus:ring-offset-background focus:ring-primary ${
        value ? "bg-black" : "bg-gray-200"
      }`}
      onClick={() => onUpdate(!value)}
      aria-pressed={value}
    >
      <span
        className={`block w-4 h-4 rounded-full bg-background shadow-md transform transition-transform duration-300 ease-in-out ${
          value ? "translate-x-6" : "translate-x-0"
        }`}
      />
    </button>
  );
};
