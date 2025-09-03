import { Fragment } from 'react';

export const ConditionalRender = ({
  condition,
  children,
}: {
  condition: boolean;
  children: React.ReactNode;
}) => {
  return condition ? children : <Fragment />;
};
