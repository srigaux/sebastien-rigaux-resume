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
  <ResumeItem title={institution} subtitle={`${studyType} ${area} `} date={date}>
    {description && (
      <>
        <div dangerouslySetInnerHTML={{ __html: description }} />
      </>
    )}
    {gpa && (
      <>
        {description && <br />}
        {gpa}
      </>
    )}
  </ResumeItem>
);
export default EducationItem;
