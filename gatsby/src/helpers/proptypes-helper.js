import PropTypes from 'prop-types';

export const LocalizablePropTypes = type =>
  PropTypes.exact({
    fr: type,
    en: type,
  });
