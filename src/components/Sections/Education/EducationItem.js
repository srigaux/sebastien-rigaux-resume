import React from 'react';
import ResumeItem from '../ResumeItem';

const EducationItem = ({
  institution,
  studyType,
  area,
  description,
  gpa,
  date,
}) => (
  <ResumeItem title={institution} subtitle={`${studyType} ${area}`} date={date}>
    {description && (
      <>
        <br />
        <div dangerouslySetInnerHTML={{ __html: description }} />
      </>
    )}
    {gpa && (
      <>
        <br />
        {gpa}
      </>
    )}
  </ResumeItem>
);
export default EducationItem;
