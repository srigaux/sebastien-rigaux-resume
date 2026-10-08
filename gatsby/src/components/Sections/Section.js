import React from 'react';
import PropTypes from 'prop-types';

import { Fade } from 'react-reveal';

const Section = ({ id, title, children }) => (
  <section
    className="resume-section p-3 p-lg-5 d-flex align-items-center"
    id={id}
  >
    <div className="w-100">
      <Fade>
        <h2 className="mb-5">{title}</h2>
      </Fade>
      {children}
    </div>
  </section>
);

Section.propTypes = {
  id: PropTypes.string.isRequired,
  title: PropTypes.string.isRequired,
};

export default Section;
