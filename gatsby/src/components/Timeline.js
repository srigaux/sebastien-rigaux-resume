import React from 'react';
import { Fade } from 'react-reveal';

const DefaultAnimation = props => <Fade bottom {...props} />;

const Timeline = ({ children, AnimationComponent = DefaultAnimation }) => (
  <div className="timeline">
    {children.map((child, idx) => (
      <AnimationComponent key={child.key || idx}>{child}</AnimationComponent>
    ))}
  </div>
);

export default Timeline;
