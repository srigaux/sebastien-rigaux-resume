import React from 'react';
import PropTypes from 'prop-types';
import Logo from '../../../assets/img/logo.inline.svg';
import SocialLinks from './SocialLinks';
import { Fade } from 'react-reveal';
import { LocalizablePropTypes } from '../../../helpers/proptypes-helper';
import { injectIntl } from 'react-intl';

const About = props => (
  <section
    className="resume-section p-3 p-lg-5 d-flex align-items-center"
    id="about"
  >
    <div className="w-100">
      <div className="row">
        <Fade delay={0}>
          <div className="col-sm-3 d-lg-none ">
            <Logo
              className="img img-fluid fluid"
              style={{ maxHeight: '11rem' }}
            />
          </div>
        </Fade>
        <Fade delay={200}>
          <div className="col-sm-9 col-lg-8 col-xl-8 text-center text-sm-left">
            <h1 className="mb-0">
              {props.firstName}
              <br />
              {props.lastName}
            </h1>
            <div className="subheading mb-5">{props.label}</div>
          </div>
          <div className="offset-sm-3 offset-lg-0 col-lg-4 col-xl-4">
            <div className="subheading mb-5">
              {props.address.formatted} <br />
              {props.phone} <br />
              <a href={`mailto:${props.email}`}>{props.email}</a>
            </div>
          </div>
        </Fade>
      </div>

      <Fade delay={400}>
        <div className="row mb-5">
          <div className="col-lg-8 col-xl-9">
            <p className="lead ">{props.about[props.intl.locale]}</p>
          </div>

          <div className="col-lg-4 col-xl-3 ml-5 ml-lg-0">
            <SocialLinks socialLinks={props.socialLinks} />
          </div>
        </div>
      </Fade>
    </div>
  </section>
);

About.prototype = {
  firstName: PropTypes.string.isRequired,
  lastName: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  address: PropTypes.shape({
    formatted: PropTypes.string.isRequired,
  }),
  phone: PropTypes.string.isRequired,
  email: PropTypes.string.isRequired,
  about: LocalizablePropTypes(PropTypes.string.isRequired),
  socialLinks: PropTypes.arrayOf(PropTypes.any),
};

export default injectIntl(About);
