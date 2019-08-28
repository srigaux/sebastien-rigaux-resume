import React from 'react';
import PropTypes from 'prop-types';

const ResumeItem = ({ title, subtitle, date, html, children }) => (
  <div className="resume-item mb-5">
    <div className="d-flex flex-column flex-md-row justify-content-between">
      <div className="resume-content">
        <h3 className="mb-0">{title}</h3>
        <div className="resume-item-subheading mb-3">{subtitle}</div>
      </div>
      <div className="resume-item-date text-md-right">
        <span className="text-primary">{date}</span>
      </div>
    </div>
    {html ? (
      <div
        className="resume-item-description"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    ) : (
      <div className="resume-item-description">{children}</div>
    )}
  </div>
);

ResumeItem.propTypes = {
  title: PropTypes.string.isRequired,
  subtitle: PropTypes.string.isRequired,
  date: PropTypes.string,
};

export default ResumeItem;
