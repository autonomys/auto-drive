import React from 'react';

interface Activity {
  user: string;
  action: 'uploaded' | 'shared';
  fileId: string;
}

const recentActivities: Activity[] = [
  { user: 'John', action: 'uploaded', fileId: 'h89433043894320448' },
  { user: 'Anna', action: 'shared', fileId: 'h734895349547389284' },
];

export const RecentActivities = ({
  activities = recentActivities,
}: {
  activities?: Activity[];
}) => {
  return (
    <div className='max-w-md rounded-lg bg-white p-6'>
      <h2 className='mb-4 text-xl font-semibold'>Recent Global Activities:</h2>
      <ul className='space-y-2'>
        {activities.map((activity, index) => (
          <li key={index} className='text-sm'>
            <span className='font-medium'>{activity.user}</span>{' '}
            <span className='text-gray-600'>{activity.action}</span>{' '}
            <span className='break-all font-mono text-xs'>{`'${activity.fileId}'`}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};
