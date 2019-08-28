import React, { Component } from 'react';
import PropTypes from 'prop-types';
import Helmet from 'react-helmet';
import { StaticQuery, graphql } from 'gatsby';
import { IntlContextConsumer } from 'gatsby-plugin-intl/intl-context';

import '../assets/sass/resume.scss';

class Layout extends Component {
  render() {
    const { children } = this.props;
    return (
      <StaticQuery
        query={graphql`
          query SiteTitleQuery {
            site {
              siteMetadata {
                title
              }
            }
          }
        `}
        render={data => (
          <>
            <IntlContextConsumer>
              {({ language: currentLanguage }) => (
                <Helmet
                  title={data.site.siteMetadata.title}
                  meta={[
                    { name: 'description', content: 'Resume' },
                    { name: 'keywords', content: 'site, web' },
                  ]}
                >
                  <html lang={currentLanguage} />
                  {/* <meta
                http-equiv="Content-Security-Policy"
                content="default-src 'self' ; script-src 'self' 'unsafe-inline' www.google-analytics.com; style-src 'self' 'unsafe-inline'; img-src 'self' *; media-src 'self'; frame-src 'self';"
              ></meta> */}
                </Helmet>
              )}
            </IntlContextConsumer>
            <div className={'main-body'}>{children}</div>
          </>
        )}
      />
    );
  }
}

Layout.propTypes = {
  children: PropTypes.node.isRequired,
};

export default Layout;
