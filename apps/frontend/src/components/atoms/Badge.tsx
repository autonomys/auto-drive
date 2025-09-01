export type Status = 'Processing' | 'Publishing' | 'Archiving' | 'Archived';

export const Badge = ({ label, status }: { label: string; status: Status }) => {
  const getStatusColor = (status: Status) => {
    switch (status) {
      case 'Processing':
        return 'bg-blue-100 text-blue-800';
      case 'Publishing':
        return 'bg-yellow-100 text-yellow-800';
      case 'Archiving':
        return 'bg-purple-100 text-purple-800';
      case 'Archived':
        return 'bg-green-100 text-green-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <span
      className={`rounded-full px-2 py-1 text-xs font-semibold ${getStatusColor(
        status,
      )}`}
    >
      {label}
    </span>
  );
};

export default Badge;
