import React from 'react';
import PropTypes from 'prop-types';

const SocialLinks = ({ socialLinks }) => (
  <div className="social-icons">
    {socialLinks
      .filter(social => social.url)
      .map(social => {
        const { icon, url, identifier } = social;
        return (
          <div key={url}>
            <a
              className="d-block"
              href={url}
              target="_blank"
              rel="noopener noreferrer"
            >
              <i className={`fab ${icon}`}></i>
              {identifier}
            </a>
          </div>
        );
      })}
  </div>
);

SocialLinks.propTypes = {
  socialLinks: PropTypes.arrayOf(
    PropTypes.shape({
      icon: PropTypes.string.isRequired,
      url: PropTypes.string.isRequired,
      identifier: PropTypes.string.isRequired,
    })
  ).isRequired,
};

export default SocialLinks;
