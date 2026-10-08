import React from 'react';
import ResumeItem from '../ResumeItem';

const ExperienceItem = ({ title, company, description, date }) => (
  <ResumeItem title={title} subtitle={company} date={date} html={description} />
);

export default ExperienceItem;
