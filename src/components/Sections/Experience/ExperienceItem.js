import React from 'react';
import PropTypes from 'prop-types';
import ResumeItem from '../ResumeItem';
import { injectIntl } from 'react-intl';
import { LocalizablePropTypes } from '../../../helpers/proptypes-helper';

const ExperienceItem = ({
  title,
  company,
  description,
  date,
  intl: { locale },
}) => (
  <ResumeItem title={title[locale]} subtitle={company} date={date}>
    {description[locale]}
  </ResumeItem>
);

ExperienceItem.propTypes = {
  title: LocalizablePropTypes(PropTypes.string.isRequired),
  company: PropTypes.string,
  description: LocalizablePropTypes(PropTypes.string.isRequired),
  date: PropTypes.string,
};

export default injectIntl(ExperienceItem);
